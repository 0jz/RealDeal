// The search swarm. Every agent is a Mozaik participant that reacts to events
// on the shared runtime on its own; none waits for another to finish. Results
// stream in: the ranker updates a search's rows on every finding, so the first
// matches show up while slower sources are still paging.

import { checkThirtyDay } from "../rules/thirtyDay"
import { defineAgent, on } from "../agents/kit"
import { emit, initializeRuntime, INITIAL_TRUST, join, resolveRuntime, SearchState, type Session } from "../runtime"
import { SOURCES } from "../sources"
import { CATALOGUE, PRODUCTS } from "./catalogue"
import {
	EV,
	type DiscountChecked,
	type ListingFound,
	type ListingMatched,
	type PageNext,
	type PriceAssessed,
	type SearchPlanned,
	type SearchRequested,
	type ShopTrustChanged,
	type SourceDone,
} from "./events"
import { llmMatch } from "./llm"
import { expandQuery, matchTitle, resolveQuery } from "./matcher"
import { baselinePrice, conditionGroup, estimateSale, marketPrice, priceFlag, rowScore, rowWhy, TRUST_THRESHOLD } from "./rank"
import type { Condition, ResultRow, SourceAdapter } from "./types"

/** Stop rules for paging: whichever fires first. */
export const MAX_PAGES = 4
export const TIME_BUDGET_MS = 12_000
export const ENOUGH_MATCHES = 150
/** Shop trust: lost when caught faking a discount, won back slowly when one checks out. */
export const PENALTY = 10
export const RECOVERY = 3

const keyOf = (l: { source: string; id: string }) => `${l.source}|${l.id}`
const sessionOf = (id: string): Session | undefined => resolveRuntime().state.session(id)

// ---- QueryAgent ---------------------------------------------------------

const QUERY = "QueryAgent"

export const queryAgent = defineAgent(QUERY, "Understands what the user asked for and plans the literal terms every source searches.", [
	on<SearchRequested>([EV.searchRequested], QUERY, async ({ searchId, request }, _e, selfId) => {
		const s = sessionOf(searchId)
		if (!s) return "unknown search"
		const resolved = resolveQuery(request.query)
		const category = request.category ?? resolved.category
		let terms = expandQuery(request.query, 4)
		let productIds = resolved.productIds

		// "best phone for 100k": search the models in that category a budget could plausibly reach.
		if (request.mode === "budget" && !productIds.length && category) {
			const budget = request.budget ?? Infinity
			productIds = CATALOGUE.filter((p) => p.category === category && p.msrp * 0.5 <= budget)
				.sort((a, b) => b.score - a.score)
				.slice(0, 8)
				.map((p) => p.id)
			terms = productIds.map((id) => PRODUCTS.get(id)!.model.toLowerCase())
		}
		if (!terms.length) terms = [request.query.trim().toLowerCase()]

		const plan: SearchPlanned = { searchId, terms, productIds, category, storageGb: resolved.storageGb }
		s.plan = plan
		for (const src of SOURCES) s.sources.set(src.id, { id: src.id, name: src.name, live: src.live, state: "searching", pages: 0, found: 0 })
		emit(EV.searchPlanned, selfId, plan)
		return `${terms.length} terms, ${productIds.length || "any"} products${category ? `, ${category}` : ""}`
	}),
])

// ---- SourceAgents (one per site) ----------------------------------------

function sourceAgent(src: SourceAdapter) {
	const name = `Source:${src.id}`
	/** Terms still paging, per search. */
	const open = new Map<string, number>()

	const finish = (searchId: string, selfId: string, reason: string) => {
		const left = (open.get(searchId) ?? 1) - 1
		open.set(searchId, left)
		if (left > 0) return
		open.delete(searchId)
		const st = sessionOf(searchId)?.sources.get(src.id)
		if (!st) return
		st.state = "done"
		const done: SourceDone = { searchId, source: src.id, pages: st.pages, found: st.found, reason }
		emit(EV.sourceDone, selfId, done)
	}

	return defineAgent(name, `Searches ${src.name} page by page for every planned term.`, [
		on<SearchPlanned>([EV.searchPlanned], name, async (plan, _e, selfId) => {
			open.set(plan.searchId, plan.terms.length)
			// Each term pages on its own: page 1 of every term goes out at once.
			for (const term of plan.terms) emit(EV.pageNext, selfId, { searchId: plan.searchId, source: src.id, term, page: 1 } satisfies PageNext)
			return `${plan.terms.length} terms`
		}),
		on<PageNext>(
			[EV.pageNext],
			name,
			async ({ searchId, term, page }, _e, selfId) => {
				const s = sessionOf(searchId)
				if (!s) return "unknown search"
				const st = s.sources.get(src.id)!
				const result = await src.search(term, page)
				st.pages++
				let fresh = 0
				for (const listing of result.listings) {
					const key = keyOf(listing)
					if (s.seen.has(key)) continue
					s.seen.add(key)
					fresh++
					st.found++
					emit(EV.listingFound, selfId, { searchId, term, listing } satisfies ListingFound)
				}
				const stop = !result.hasMore
					? "last page"
					: page >= MAX_PAGES
						? "page limit"
						: Date.now() - s.startedAt > TIME_BUDGET_MS
							? "time budget"
							: s.listings.size >= ENOUGH_MATCHES
								? "enough matches"
								: s.cancelled
									? "cancelled"
									: null
				if (stop) finish(searchId, selfId, stop)
				else emit(EV.pageNext, selfId, { searchId, source: src.id, term, page: page + 1 } satisfies PageNext)
				return `"${term}" p${page}: ${fresh} new${stop ? `, stop (${stop})` : ""}`
			},
			(p) => p.source === src.id,
		),
	])
}

// ---- MatcherAgent -------------------------------------------------------

const MATCHER = "MatcherAgent"

export const matcherAgent = defineAgent(MATCHER, "Maps each raw listing to a catalogue product despite misspellings, or rejects it.", [
	on<ListingFound>([EV.listingFound], MATCHER, async ({ searchId, listing }, _e, selfId) => {
		const s = sessionOf(searchId)
		if (!s?.plan) return "unknown search"
		const key = keyOf(listing)
		let match = matchTitle(listing.title, listing.description)
		if (!match.productId && !match.reject) match = (await llmMatch(listing.title)) ?? match

		const plan = s.plan
		let reason = match.reject ?? (match.productId ? null : "unknown product")
		if (!reason && plan.productIds.length && !plan.productIds.includes(match.productId!)) reason = "different model"
		if (!reason && !plan.productIds.length && plan.category && PRODUCTS.get(match.productId!)?.category !== plan.category) reason = "other category"
		if (reason) {
			s.rejected++
			emit(EV.listingRejected, selfId, { searchId, key, title: listing.title, reason })
			return `reject "${listing.title}": ${reason}`
		}
		s.listings.set(key, listing)
		emit(EV.listingMatched, selfId, { searchId, key, listing, match } satisfies ListingMatched)
		return `"${listing.title}" → ${match.productId} (${match.method} ${match.confidence.toFixed(2)})`
	}),
])

// ---- PriceAgent ---------------------------------------------------------

const PRICE = "PriceAgent"
const totalOf = (l: { price: number; shipping?: number | null }) => l.price + (l.shipping ?? 0)

export const priceAgent = defineAgent(PRICE, "Estimates the market price per model and condition and flags too-cheap and too-expensive listings.", [
	on<ListingMatched>([EV.listingMatched], PRICE, async ({ searchId, key, listing, match }, _e, selfId) => {
		const s = sessionOf(searchId)
		if (!s) return "unknown search"
		const pid = match.productId!
		const cond = match.condition ?? listing.condition ?? null
		const group = conditionGroup(cond)
		// Comparables: same product and condition group already matched in this search, excluding scam-priced ones.
		const comparable = [...s.rows.values()]
			.filter((r) => r.productId === pid && conditionGroup(r.condition) === group && r.flag !== "suspicious")
			.map((r) => r.total)
		const market = marketPrice(comparable, baselinePrice(pid, cond, match.storageGb ?? null))
		const flag = priceFlag(totalOf(listing), market, listing.source === "kp")
		const assessed: PriceAssessed = { searchId, key, productId: pid, market, flag }
		s.prices.set(key, assessed)
		emit(EV.priceAssessed, selfId, assessed)
		return `${pid} ${totalOf(listing)} vs ${market ?? "?"}: ${flag}`
	}),
])

// ---- ShopCheckAgent (30-day rule + shop trust) ---------------------------

const SHOP = "ShopCheckAgent"
/** Each advertised offer moves a shop's trust once, however many searches see it. */
const judged = new Set<string>()

export const shopCheckAgent = defineAgent(SHOP, "Checks a shop's advertised discount against the 30-day rule and keeps a trust score per shop.", [
	on<ListingMatched>(
		[EV.listingMatched],
		SHOP,
		async ({ searchId, key, listing }, _e, selfId) => {
			const s = sessionOf(searchId)
			if (!s) return "unknown search"
			const shopId = listing.shopId!
			const r = checkThirtyDay({ history: listing.history!, shownPrevPrice: listing.shownPrevPrice! }, listing.price)
			if (r.status === "insufficient-history" || r.status === "exception") return `${shopId}: reference check inconclusive`
			const checked: DiscountChecked = { searchId, key, shopId, legal: r.legal, realLow: r.realLow, claimedPct: r.claimedDiscountPct, realPct: r.realDiscountPct }
			s.discounts.set(key, checked)
			emit(EV.discountChecked, selfId, checked)

			const { trust } = resolveRuntime().state
			if (!trust.has(shopId)) trust.set(shopId, INITIAL_TRUST)
			if (judged.has(key) || r.claimedDiscountPct <= 0) return `${shopId} ${r.legal ? "ok" : "FAKE"}`
			judged.add(key)
			const previous = trust.get(shopId)!
			const next = r.legal ? Math.min(100, previous + RECOVERY) : Math.max(0, previous - PENALTY)
			if (next !== previous) {
				trust.set(shopId, next)
				emit(EV.shopTrustChanged, selfId, { shopId, trust: next, previous, caught: !r.legal } satisfies ShopTrustChanged)
			}
			return `${shopId} ${r.legal ? "ok" : "FAKE"} trust ${previous} → ${next}`
		},
		(p) => !!p.listing.history && p.listing.shownPrevPrice != null && !!p.listing.shopId,
	),
])

// ---- RankerAgent --------------------------------------------------------

const RANKER = "RankerAgent"

function buildRow(s: Session, key: string): ResultRow | null {
	const listing = s.listings.get(key)
	const matched = matchCache.get(`${s.id}|${key}`)
	if (!listing || !matched) return null
	const src = SOURCES.find((x) => x.id === listing.source)
	const price = s.prices.get(key)
	const d = s.discounts.get(key)
	const trust = listing.shopId ? (resolveRuntime().state.trust.get(listing.shopId) ?? null) : null
	const row: ResultRow = {
		key,
		source: listing.source,
		sourceName: src?.name ?? listing.source,
		kind: src?.kind ?? "classified",
		title: listing.title,
		url: listing.url,
		price: listing.price,
		shipping: listing.shipping ?? null,
		total: totalOf(listing),
		condition: (matched.condition ?? listing.condition ?? null) as Condition | null,
		city: listing.city ?? null,
		shopName: listing.shopName ?? null,
		image: listing.image ?? null,
		storageGb: matched.storageGb ?? null,
		productId: matched.productId!,
		confidence: matched.confidence,
		method: matched.method,
		market: price?.market ?? null,
		flag: price?.flag ?? null,
		thirtyDay: d ? { legal: d.legal, realLow: d.realLow, claimedPct: d.claimedPct, realPct: d.realPct } : null,
		shopTrust: trust,
		score: 0,
		why: "",
	}
	row.score = rowScore(row)
	row.why = rowWhy(row)
	return row
}

/** MatcherAgent's verdict per (search, listing), so the ranker can build rows. */
const matchCache = new Map<string, ListingMatched["match"]>()

export const rankerAgent = defineAgent(RANKER, "Keeps every search's ranked result list current and re-scores rows whenever any agent reports.", [
	on<ListingMatched | PriceAssessed | DiscountChecked>([EV.listingMatched, EV.priceAssessed, EV.discountChecked], RANKER, async (p, e, selfId) => {
		const s = sessionOf(p.searchId)
		if (!s) return "unknown search"
		if (e.type === EV.listingMatched) matchCache.set(`${s.id}|${p.key}`, (p as ListingMatched).match)
		const row = buildRow(s, p.key)
		if (!row) return "waiting for match"
		s.rows.set(p.key, row)
		emit(EV.resultsUpdated, selfId, { searchId: s.id, key: p.key })
		return `${row.productId} ${row.total} score ${row.score}`
	}),
	// Cascade: a shop caught faking drops below the threshold → every row from that shop, in every open search, is re-scored at once.
	on<ShopTrustChanged>([EV.shopTrustChanged], RANKER, async ({ shopId, trust }, _e, selfId) => {
		let n = 0
		for (const s of resolveRuntime().state.sessions.values()) {
			let touched = false
			for (const [key, row] of s.rows) {
				if (s.listings.get(key)?.shopId !== shopId) continue
				const next = buildRow(s, key)
				if (next) s.rows.set(key, next)
				touched = true
				n++
			}
			if (touched) emit(EV.resultsUpdated, selfId, { searchId: s.id, key: null })
		}
		return `${shopId} trust ${trust}: ${n} rows re-scored${trust < TRUST_THRESHOLD ? " (under threshold)" : ""}`
	}),
])

// ---- SellAgent ----------------------------------------------------------

const SELL = "SellAgent"

export const sellAgent = defineAgent(SELL, "Prices an item the user wants to sell from comparable listings and drafts the ad.", [
	on<{ searchId: string }>(
		[EV.resultsUpdated, EV.sourceDone],
		SELL,
		async ({ searchId }, _e, selfId) => {
			const s = sessionOf(searchId)
			if (!s?.plan) return "unknown search"
			const text = s.request.query
			const m = matchTitle(text)
			const productId = s.plan.productIds[0] ?? m.productId ?? null
			const condition: Condition = m.condition ?? "used"
			// Re-estimated as every comp comes in, so the price range firms up live.
			s.sell = estimateSale({ productId, condition, storageGb: m.storageGb ?? s.plan.storageGb, text, rows: [...s.rows.values()] })
			emit(EV.sellEstimate, selfId, { searchId })
			return `${productId ?? "?"}: ${s.sell.quick ?? "?"}–${s.sell.patient ?? "?"} from ${s.sell.comps.length} comps`
		},
		(p) => sessionOf(p.searchId)?.request.mode === "sell",
	),
])

// ---- start --------------------------------------------------------------

let started = false

/** Initializes the shared runtime and joins every agent. Safe to call more than once. */
export function startEngine(): SearchState {
	if (started) return resolveRuntime().state
	started = true
	const runtime = initializeRuntime({ state: new SearchState() })
	for (const p of [queryAgent, ...SOURCES.map(sourceAgent), matcherAgent, priceAgent, shopCheckAgent, rankerAgent, sellAgent]) join(p)
	return runtime.state
}
