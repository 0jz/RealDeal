// The polite fetcher. Every live adapter must use politeFetch, never fetch() directly:
// it checks robots.txt, rate-limits per host, caches, retries and identifies itself.

const USER_AGENT = "RealDealBot/0.1 (+research prototype)"
const ROBOTS_TOKEN = "realdealbot"
const CACHE_TTL_MS = 10 * 60 * 1000
const TIMEOUT_MS = 15_000
const MAX_RETRIES = 3
const DEFAULT_INTERVAL_MS = 2_000

class HttpError extends Error {
	constructor(
		readonly status: number,
		url: string,
	) {
		super(`HTTP ${status} for ${url}`)
	}
}

type Rule = { allow: boolean; pattern: string }
type Group = { agents: string[]; rules: Rule[] }

const cache = new Map<string, { at: number; body: string }>()
const robotsCache = new Map<string, Promise<string>>()
const hostSlots = new Map<string, { chain: Promise<unknown>; last: number }>()

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Runs fn once the previous job for this host is done and at least minIntervalMs has passed since its start. */
function enqueue<T>(host: string, minIntervalMs: number, fn: () => Promise<T>): Promise<T> {
	const slot = hostSlots.get(host) ?? { chain: Promise.resolve(), last: 0 }
	const run = slot.chain.then(async () => {
		const wait = slot.last + minIntervalMs - Date.now()
		if (wait > 0) await sleep(wait)
		slot.last = Date.now()
		return fn()
	})
	slot.chain = run.catch(() => undefined)
	hostSlots.set(host, slot)
	return run
}

type Attempt = { ok: true; body: string } | { ok: false; retry: boolean; error: Error }

async function attemptOnce(url: string): Promise<Attempt> {
	try {
		const res = await fetch(url, {
			headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		})
		if (res.ok) return { ok: true, body: await res.text() }
		return { ok: false, retry: res.status === 429 || res.status >= 500, error: new HttpError(res.status, url) }
	} catch (err) {
		return { ok: false, retry: true, error: err instanceof Error ? err : new Error(String(err)) }
	}
}

async function getWithRetry(url: string): Promise<string> {
	for (let attempt = 0; ; attempt++) {
		const out = await attemptOnce(url)
		if (out.ok) return out.body
		if (!out.retry || attempt >= MAX_RETRIES) throw out.error
		await sleep(1000 * 2 ** attempt)
	}
}

async function fetchRobots(origin: string): Promise<string> {
	try {
		return await getWithRetry(`${origin}/robots.txt`)
	} catch (err) {
		// No robots.txt means no restrictions. Anything else (401, 403, outage) blocks the host for now.
		if (err instanceof HttpError && (err.status === 404 || err.status === 410)) return ""
		throw err
	}
}

function getRobots(origin: string): Promise<string> {
	let robots = robotsCache.get(origin)
	if (!robots) {
		robots = enqueue(new URL(origin).host, DEFAULT_INTERVAL_MS, () => fetchRobots(origin))
		robotsCache.set(origin, robots)
		robots.catch(() => robotsCache.delete(origin)) // try again next time
	}
	return robots
}

/** `fresh` skips the cache read (a re-check must see the live page); the result still refreshes the cache. */
export async function politeFetch(url: string, opts: { minIntervalMs?: number; fresh?: boolean } = {}): Promise<string> {
	const cached = cache.get(url)
	if (!opts.fresh && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.body

	const target = new URL(url)
	const robots = await getRobots(target.origin)
	if (!isAllowedByRobots(robots, target.pathname + target.search)) throw new Error(`blocked by robots.txt: ${url}`)

	const body = await enqueue(target.host, opts.minIntervalMs ?? DEFAULT_INTERVAL_MS, () => getWithRetry(url))
	cache.set(url, { at: Date.now(), body })
	return body
}

/** The content-type of a URL (lowercased, no parameters), via HEAD. Null on any failure.
 * For this one HEAD of an image a shop embeds in its own page, a 4xx robots.txt (an image bucket
 * like static.ananas.rs answers 403) counts as no robots.txt, as RFC 9309 says. Page fetches stay stricter. */
export async function politeContentType(url: string): Promise<string | null> {
	try {
		const target = new URL(url)
		const robots = await getRobots(target.origin).catch(err => {
			if (err instanceof HttpError && err.status >= 400 && err.status < 500 && err.status !== 429) return ""
			throw err
		})
		if (!isAllowedByRobots(robots, target.pathname + target.search)) return null
		return await enqueue(target.host, DEFAULT_INTERVAL_MS, () => headContentType(url))
	} catch {
		return null
	}
}

async function headContentType(url: string): Promise<string | null> {
	const headers = { "user-agent": USER_AGENT }
	let res = await fetch(url, { method: "HEAD", headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
	if (res.status === 405) {
		// Some servers refuse HEAD. Read the headers of a GET and drop the body unread.
		res = await fetch(url, { headers: { ...headers, accept: "*/*" }, signal: AbortSignal.timeout(TIMEOUT_MS) })
		await res.body?.cancel().catch(() => undefined)
	}
	if (!res.ok) return null
	return res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || null
}

function parseRobots(txt: string): Group[] {
	const groups: Group[] = []
	let inAgentLines = false
	for (const raw of txt.split(/\r?\n/)) {
		const line = raw.replace(/#.*/, "").trim()
		const colon = line.indexOf(":")
		if (colon < 0) continue
		const key = line.slice(0, colon).trim().toLowerCase()
		const value = line.slice(colon + 1).trim()
		if (key === "user-agent") {
			// Consecutive User-agent lines share one group.
			if (!inAgentLines) groups.push({ agents: [], rules: [] })
			groups[groups.length - 1]?.agents.push(value.toLowerCase())
			inAgentLines = true
			continue
		}
		inAgentLines = false
		if ((key === "allow" || key === "disallow") && value && groups.length > 0) {
			groups[groups.length - 1]?.rules.push({ allow: key === "allow", pattern: value })
		}
	}
	return groups
}

const escapeRegex = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")

/** Path prefix match with * wildcards and a trailing $ anchor. */
function pathMatches(pattern: string, path: string): boolean {
	const anchored = pattern.endsWith("$")
	const body = anchored ? pattern.slice(0, -1) : pattern
	return new RegExp(`^${body.split("*").map(escapeRegex).join(".*")}${anchored ? "$" : ""}`).test(path)
}

/** Pure robots.txt check. A group naming us wins over the "*" group. Longest matching rule wins; Allow wins ties. */
export function isAllowedByRobots(robotsTxt: string, path: string): boolean {
	const groups = parseRobots(robotsTxt)
	const ours = groups.find((g) => g.agents.some((a) => a !== "*" && ROBOTS_TOKEN.includes(a)))
	const star = groups.find((g) => g.agents.includes("*"))
	const rules = (ours ?? star)?.rules ?? []

	let best: Rule | null = null
	for (const rule of rules) {
		if (!pathMatches(rule.pattern, path)) continue
		if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule
	}
	return best ? best.allow : true
}
