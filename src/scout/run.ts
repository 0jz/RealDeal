// Query → scouts → judge → rank → verify, with live partial results and a short cache.

import { budgetBands, groupByBudget } from "../search/budget"
import { judge } from "./judge"
import { buildQueries, fold, siteFits } from "./query"
import { filterRange, rank, toSlots, total } from "./rank"
import type {
	ScoutCandidate,
	ScoutListing,
	ScoutResult,
	ScoutSite,
	ScoutTrace,
	ScoutWant,
	ShopScout,
	SiteReport,
} from "./types"
import { SCOUT_SITES, SITE_NAMES, ScoutBlocked } from "./types"
import { verifyRanked, type VerifyDeps } from "./verify"

export const SCOUT_BUDGET_MS = Number(process.env.SCOUT_BUDGET_MS) || 300_000
export const SCOUT_PAGES_PER_SITE = Number(process.env.SCOUT_PAGES_PER_SITE) || 20

export type RunEvent = { site: ScoutSite | "query" | "judge" | "verify"; kind: "start" | "page" | "done" | "error"; detail: string }

export type RunDeps = {
	scouts: ShopScout[]
	offNotes?: Partial<Record<ScoutSite, string>>
	verify: VerifyDeps
	llmJudge?: Parameters<typeof judge>[2]
	now?: () => number
	budgetMs?: number
	pagesPerSite?: number
	onEvent?: (e: RunEvent) => void
	onPartial?: (r: ScoutResult) => void
	isCancelled?: () => boolean
}

const CACHE_TTL_MS = 30 * 60_000
const cache = new Map<string, { result: ScoutResult; expires: number }>()

export function clearScoutCache(): void {
	cache.clear()
}

function cacheKey(want: ScoutWant): string {
	const norm = (text: string) => fold(text).toLowerCase().replace(/\s+/g, " ").trim()
	return JSON.stringify([norm(want.query), want.attributes.map(norm).sort(), want.minPrice ?? null, want.maxPrice ?? null])
}

type SiteOutcome = { site: ScoutSite; report: SiteReport; candidates: ScoutCandidate[] }

function emit(deps: RunDeps, site: RunEvent["site"], kind: RunEvent["kind"], detail: string): void {
	deps.onEvent?.({ site, kind, detail })
}

function message(err: unknown): string {
	return err instanceof Error ? err.message : String(err)
}

function emptySites(): Record<ScoutSite, SiteReport> {
	return {
		tehnomedia: { status: "ok", pages: 0, found: 0 },
		ananas: { status: "ok", pages: 0, found: 0 },
		officeshoes: { status: "ok", pages: 0, found: 0 },
		gigatron: { status: "ok", pages: 0, found: 0 },
		eponuda: { status: "ok", pages: 0, found: 0 },
		cenoteka: { status: "ok", pages: 0, found: 0 },
	}
}

/** All searches, then pages in order until the site's page or time limit runs out. */
async function scoutSite(
	site: ScoutSite,
	scout: ShopScout,
	want: ScoutWant,
	queries: string[],
	deps: RunDeps,
	start: number,
	budget: number,
	pagesPerSite: number,
): Promise<SiteOutcome> {
	const report: SiteReport = { status: "ok", pages: 0, found: 0 }
	const candidates: ScoutCandidate[] = []
	const urls: string[] = []
	const seen = new Set<string>()
	emit(deps, site, "start", SITE_NAMES[site])
	try {
		const bands = want.maxPrice !== undefined ? budgetBands(want.maxPrice) : []
		const ranges = scout.supportsPriceRange && bands.length
			? bands.map(b => ({ minPrice: Math.max(want.minPrice ?? 1, b.min), maxPrice: b.max })).filter(r => r.minPrice <= r.maxPrice)
			: [{ minPrice: want.minPrice, maxPrice: want.maxPrice }]
		const queues: string[][] = []
		for (const query of queries) {
			for (const range of ranges) {
				if (deps.isCancelled?.() || (deps.now ?? Date.now)() - start >= budget) break
				queues.push(await scout.search(query, range))
			}
		}
		// Round-robin prevents the first query or price band consuming every page slot.
		for (let i = 0; queues.some(q => i < q.length); i++) {
			for (const queue of queues) {
				const url = queue[i]
				if (!url || seen.has(url)) continue
				seen.add(url)
				urls.push(url)
			}
		}
		let timedOut = (deps.now ?? Date.now)() - start >= budget
		for (const url of urls) {
			if (report.pages >= pagesPerSite || deps.isCancelled?.()) break
			if ((deps.now ?? Date.now)() - start >= budget) {
				timedOut = true
				break
			}
			report.pages++
			emit(deps, site, "page", url)
			try {
				const candidate = await scout.read(url)
				if (candidate) {
					candidates.push(candidate)
					report.found++
				}
			} catch (err) {
				if (err instanceof ScoutBlocked) throw err
				emit(deps, site, "error", `${url}: ${message(err)}`)
			}
		}
		report.status = timedOut ? "timeout" : "ok"
		emit(deps, site, "done", `${report.pages} pages, ${report.found} found`)
	} catch (err) {
		report.status = err instanceof ScoutBlocked ? "blocked" : "error"
		report.note = message(err)
		emit(deps, site, "error", report.note)
	}
	return { site, report, candidates }
}

function candidateOf(l: ScoutListing): ScoutCandidate {
	return {
		site: l.site,
		shop: l.shop,
		title: l.title,
		category: l.category,
		price: l.price,
		delivery: l.delivery,
		inStock: l.inStock,
		url: l.url,
		image: l.image,
		checkedAt: l.checkedAt,
	}
}

/** Partial results stop before verification; the finished result only shows verified listings. */
async function buildResult(
	want: ScoutWant,
	candidates: ScoutCandidate[],
	sites: Record<ScoutSite, SiteReport>,
	deps: RunDeps,
	finish: { verify: boolean; finishedAt: string },
): Promise<ScoutResult> {
	const range = filterRange(candidates, want)
	if (finish.verify) emit(deps, "judge", "start", `${range.kept.length} candidates`)
	const verdict = await judge(want, range.kept, deps.llmJudge)
	if (finish.verify) emit(deps, "judge", "done", `${verdict.judged.length} judged`)
	const ranked = rank(verdict.judged)
	const slots = toSlots(ranked.ordered)
	const trace: ScoutTrace[] = [...range.dropped, ...verdict.dropped, ...ranked.dropped]
	let shown = ranked.ordered
	let best = slots.best
	let next = slots.next
	let mentions = slots.mentions
	if (finish.verify) {
		emit(deps, "verify", "start", `${ranked.ordered.length} listings`)
		const bands = want.maxPrice === undefined ? [] : groupByBudget(ranked.ordered, want.maxPrice, total, Infinity)
		// Verify within each band so ten cheaper matches cannot crowd out the top tier.
		const checks = bands.length
			? await Promise.all(bands.map(b => verifyRanked(b.items, deps.verify, 3, deps.isCancelled)))
			: [await verifyRanked(ranked.ordered, deps.verify, 10, deps.isCancelled)]
		const verifiedByUrl = new Map(checks.flatMap(c => c.kept).map(l => [l.url, l]))
		const kept = ranked.ordered.flatMap(l => verifiedByUrl.has(l.url) ? [verifiedByUrl.get(l.url)!] : [])
		const dropped = checks.flatMap(c => c.dropped)
		shown = kept
		for (const failure of dropped) {
			if (failure.ok) continue
			trace.push({
				...candidateOf(failure.listing),
				score: failure.listing.score,
				kept: false,
				why: failure.why,
				drop: "failed verify",
			})
		}
		for (const listing of kept) trace.push({ ...candidateOf(listing), score: listing.score, kept: true, why: listing.reason })
		const attempted = new Set([...kept, ...dropped.map((d) => d.listing)].map((l) => l.url))
		for (const listing of ranked.ordered) {
			if (attempted.has(listing.url)) continue
			trace.push({ ...candidateOf(listing), score: listing.score, kept: false, why: "not verified" })
		}
		const verified = toSlots(kept)
		best = verified.best
		next = verified.next
		mentions = verified.mentions
		emit(deps, "verify", "done", `${kept.length} verified`)
	} else {
		for (const listing of ranked.ordered) {
			trace.push({ ...candidateOf(listing), score: listing.score, kept: true, why: listing.reason })
		}
	}
	return {
		budgetTiers: want.maxPrice === undefined ? [] : groupByBudget(shown, want.maxPrice, total),
		wantText: want.wantText,
		query: want.query,
		minPrice: want.minPrice,
		maxPrice: want.maxPrice,
		best,
		next,
		mentions,
		sites,
		trace,
		finishedAt: finish.finishedAt,
	}
}

export async function runScouts(want: ScoutWant, deps: RunDeps): Promise<ScoutResult> {
	const clock = deps.now ?? Date.now
	const start = clock()
	const key = cacheKey(want)
	const cached = cache.get(key)
	if (cached && start < cached.expires) return structuredClone(cached.result)

	const queries = buildQueries(want)
	emit(deps, "query", "start", queries.join(" | "))
	emit(deps, "query", "done", `${queries.length} queries`)

	const sites = emptySites()
	const running: Array<Promise<SiteOutcome>> = []
	for (const site of SCOUT_SITES) {
		const scout = deps.scouts.find((s) => s.site === site)
		if (!scout) {
			const note = deps.offNotes?.[site]
			sites[site] = { status: "off", pages: 0, found: 0, ...(note ? { note } : {}) }
			continue
		}
		if (!siteFits(site, want)) {
			sites[site] = { status: "skipped", pages: 0, found: 0, note: "not sold here" }
			continue
		}
		running.push(
			scoutSite(site, scout, want, queries, deps, start, deps.budgetMs ?? SCOUT_BUDGET_MS, deps.pagesPerSite ?? SCOUT_PAGES_PER_SITE),
		)
	}

	const outcomes = new Map<ScoutSite, SiteOutcome>()
	const pending = new Map<Promise<SiteOutcome>, Promise<{ outcome: SiteOutcome; source: Promise<SiteOutcome> }>>()
	for (const p of running) pending.set(p, p.then((outcome) => ({ outcome, source: p })))
	while (pending.size > 0) {
		const { outcome, source } = await Promise.race(pending.values())
		pending.delete(source)
		outcomes.set(outcome.site, outcome)
		const currentSites = { ...sites }
		for (const done of outcomes.values()) currentSites[done.site] = done.report
		const currentCandidates = SCOUT_SITES.flatMap((site) => outcomes.get(site)?.candidates ?? [])
		deps.onPartial?.(await buildResult(want, currentCandidates, currentSites, deps, { verify: false, finishedAt: "" }))
	}

	for (const outcome of outcomes.values()) sites[outcome.site] = outcome.report
	const result = await buildResult(want, SCOUT_SITES.flatMap((site) => outcomes.get(site)?.candidates ?? []), sites, deps, {
		verify: true,
		finishedAt: "",
	})
	result.finishedAt = new Date(clock()).toISOString()
	if (!deps.isCancelled?.()) cache.set(key, { result: structuredClone(result), expires: clock() + CACHE_TTL_MS })
	return result
}
