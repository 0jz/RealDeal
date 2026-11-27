// The polite fetcher. Every live adapter must use politeFetch, never fetch() directly:
// it checks robots.txt, rate-limits per host, caches, retries and identifies itself.

const USER_AGENT = "RealDealBot/0.1 (+research prototype)"
const ROBOTS_TOKEN = "realdealbot"
const CACHE_TTL_MS = 10 * 60 * 1000
const TIMEOUT_MS = 15_000
const MAX_RETRIES = 3
const DEFAULT_INTERVAL_MS = 2_000

export class HttpError extends Error {
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

/** How a URL is actually fetched. The default is Node's fetch; adapters on hosts
 * whose WAF blocks Node's TLS profile can pass the OS curl instead (see customer.ts). */
export type Transport = (url: string, headers: Record<string, string>) => Promise<string>

export const nodeTransport: Transport = async (url, headers) => {
	const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
	if (res.ok) return await res.text()
	throw new HttpError(res.status, url)
}

async function getWithRetry(
	url: string,
	headers: Record<string, string> = { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" },
	transport: Transport = nodeTransport,
): Promise<string> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await transport(url, headers)
		} catch (err) {
			const retryable = !(err instanceof HttpError) || err.status === 429 || err.status >= 500
			if (!retryable || attempt >= MAX_RETRIES) throw err
			await sleep(1000 * 2 ** attempt)
		}
	}
}

async function fetchRobots(origin: string, headers?: Record<string, string>, transport?: Transport): Promise<string> {
	try {
		return await getWithRetry(`${origin}/robots.txt`, headers, transport)
	} catch (err) {
		// No robots.txt means no restrictions. Anything else (401, 403, outage) blocks the host for now.
		if (err instanceof HttpError && (err.status === 404 || err.status === 410)) return ""
		throw err
	}
}

function getRobots(origin: string, headers?: Record<string, string>, transport?: Transport): Promise<string> {
	// Per profile: a host that challenges the honest bot UA may still answer a customer UA (measured on eponuda).
	const key = `${origin}|${headers?.["user-agent"] ?? "bot"}`
	let robots = robotsCache.get(key)
	if (!robots) {
		robots = enqueue(new URL(origin).host, DEFAULT_INTERVAL_MS, () => fetchRobots(origin, headers, transport))
		robotsCache.set(key, robots)
		robots.catch(() => robotsCache.delete(key)) // try again next time
	}
	return robots
}

export type PoliteOptions = {
	minIntervalMs?: number
	fresh?: boolean
	/** Extra request headers, overriding the defaults. A `user-agent` here replaces the honest bot UA. */
	headers?: Record<string, string>
	/** Random extra wait before the request, uniform in [0, jitterMs). Softens request rhythms on hosts that score them. */
	jitterMs?: number
	/** How to fetch. Defaults to Node's fetch; see Transport. */
	transport?: Transport
}

/** `fresh` skips the cache read (a re-check must see the live page); the result still refreshes the cache. */
export async function politeFetch(url: string, opts: PoliteOptions = {}): Promise<string> {
	const cached = cache.get(url)
	if (!opts.fresh && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.body

	const target = new URL(url)
	const headers = { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5", ...opts.headers }
	const robots = await getRobots(target.origin, headers, opts.transport)
	if (!isAllowedByRobots(robots, target.pathname + target.search)) throw new Error(`blocked by robots.txt: ${url}`)
	const body = await enqueue(target.host, opts.minIntervalMs ?? DEFAULT_INTERVAL_MS, async () => {
		if (opts.jitterMs) await sleep(Math.floor(Math.random() * opts.jitterMs))
		return getWithRetry(url, headers, opts.transport)
	})
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
