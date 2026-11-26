// Public API of the search engine. The website (src/server.ts) and the
// Telegram bot (src/bot/) only use these functions; neither has search logic
// of its own.

import { createHuman } from "@mozaik-ai/core"
import { randomUUID } from "node:crypto"
import { EventMatches } from "../agents/kit"
import { emit, join, resolveRuntime, Session } from "../runtime"
import { startEngine } from "./agents"
import { PRODUCTS, productName } from "./catalogue"
import { EV, type SearchRequested } from "./events"
import { choosePicks } from "./rank"
import type { ProductGroup, SearchRequest, SearchView } from "./types"

export type { SearchRequest, SearchView }

const THROTTLE_MS = 150
/** Searches are forgotten this long after they finish. */
const KEEP_MS = 15 * 60_000

const listeners = new Map<string, Set<(v: SearchView) => void>>()
const timers = new Map<string, NodeJS.Timeout>()
let observerId: string | null = null

function ensureStarted(): string {
	if (observerId) return observerId
	startEngine()
	// A passive participant that sees every event the agents publish, the same way any agent would.
	const observer = createHuman({
		name: "Frontends",
		capabilities: [],
		handlers: [
			{
				specification: new EventMatches(Object.values(EV), (p) => typeof (p as { searchId?: unknown })?.searchId === "string"),
				processor: { apply: ({ event }) => schedule((event.payload as { searchId: string }).searchId) },
			},
		],
	})
	join(observer)
	observerId = observer.getId()
	return observerId
}

function schedule(searchId: string) {
	if (timers.has(searchId)) return
	timers.set(
		searchId,
		setTimeout(() => {
			timers.delete(searchId)
			const view = getView(searchId)
			if (!view) return
			for (const l of listeners.get(searchId) ?? []) l(view)
			if (view.done) setTimeout(() => forget(searchId), KEEP_MS).unref()
		}, THROTTLE_MS),
	)
}

function forget(searchId: string) {
	resolveRuntime().state.sessions.delete(searchId)
	listeners.delete(searchId)
}

/** Starts a search on the shared runtime and returns its id. Results stream in through subscribe(). */
export function search(request: SearchRequest): string {
	const selfId = ensureStarted()
	const id = randomUUID().slice(0, 8)
	resolveRuntime().state.sessions.set(id, new Session(id, request))
	emit(EV.searchRequested, selfId, { searchId: id, request } satisfies SearchRequested)
	return id
}

/** Calls back with the full current view every time it changes (throttled), and once right away. Returns an unsubscribe function. */
export function subscribe(searchId: string, onView: (view: SearchView) => void): () => void {
	if (!listeners.has(searchId)) listeners.set(searchId, new Set())
	listeners.get(searchId)!.add(onView)
	const now = getView(searchId)
	if (now) onView(now)
	return () => listeners.get(searchId)?.delete(onView)
}

/** Current view of a search, or null if unknown. */
export function getView(searchId: string): SearchView | null {
	ensureStarted()
	const s = resolveRuntime().state.session(searchId)
	if (!s) return null
	const byProduct = new Map<string, ProductGroup>()
	for (const r of s.rows.values()) {
		let g = byProduct.get(r.productId)
		if (!g) {
			const p = PRODUCTS.get(r.productId)!
			g = { productId: r.productId, name: productName(r.productId), category: p.category, low: Infinity, market: null, rows: [] }
			byProduct.set(r.productId, g)
		}
		g.rows.push(r)
	}
	const groups = [...byProduct.values()]
	for (const g of groups) {
		g.rows.sort((a, b) => a.total - b.total)
		g.low = Math.min(...g.rows.filter((r) => r.flag !== "suspicious").map((r) => r.total), Infinity)
		if (!Number.isFinite(g.low)) g.low = g.rows[0].total
		g.market = g.rows.find((r) => r.market != null && r.condition === "used")?.market ?? g.rows.find((r) => r.market != null)?.market ?? null
	}
	// Products the query named first, then the better devices.
	const wanted = new Set(s.plan?.productIds ?? [])
	groups.sort((a, b) => Number(wanted.has(b.productId)) - Number(wanted.has(a.productId)) || PRODUCTS.get(b.productId)!.score - PRODUCTS.get(a.productId)!.score)

	const rows = [...s.rows.values()]
	const budget = s.request.mode === "budget" ? (s.request.budget ?? null) : null
	return {
		id: s.id,
		request: s.request,
		startedAt: s.startedAt,
		terms: s.plan?.terms ?? [],
		sources: [...s.sources.values()].map((x) => ({ ...x })),
		groups,
		picks: s.request.mode === "sell" ? [] : choosePicks(rows, budget),
		rejected: s.rejected,
		sell: s.sell,
		done: s.done,
	}
}

/** Stop paging sources for a search the user no longer looks at. */
export function cancel(searchId: string): void {
	const s = resolveRuntime().state.session(searchId)
	if (s) s.cancelled = true
}

export { startEngine }
