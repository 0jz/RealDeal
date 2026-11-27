import { defineRuntime, RuntimeState, SemanticEvent } from "@mozaik-ai/core"
import type { RawListing, ResultRow, SearchRequest, SellEstimate, SourceStatus } from "./search/types"
import type { DiscountChecked, PriceAssessed, SearchPlanned } from "./search/events"

export type LogEntry = {
	t: number // ms since the server started
	agent: string
	kind: "emit" | "start" | "end" | "error"
	event: string
	/** Pairs a handler's start with its end/error. */
	run?: number
	detail?: string
	searchId?: string
}

export const INITIAL_TRUST = 100

/** Everything the agents know about one search. Each field has one writer agent. */
export class Session {
	readonly startedAt = Date.now()
	plan: SearchPlanned | null = null // QueryAgent
	readonly sources = new Map<string, SourceStatus>() // SourceAgents
	/** Listing keys already handed on, so the same listing found under two spellings is matched once. */
	readonly seen = new Set<string>() // SourceAgents
	readonly listings = new Map<string, RawListing>() // MatcherAgent (matched only)
	readonly prices = new Map<string, PriceAssessed>() // PriceAgent
	readonly discounts = new Map<string, DiscountChecked>() // ShopCheckAgent
	readonly rows = new Map<string, ResultRow>() // RankerAgent
	rejected = 0 // MatcherAgent
	sell: SellEstimate | null = null // SellAgent
	/** Set by the server/bot when the user stops caring; agents stop paging. */
	cancelled = false

	constructor(
		readonly id: string,
		readonly request: SearchRequest,
	) {}

	get done(): boolean {
		if (!this.plan) return false
		if (this.request.mode === "sell" && !this.sell) return false
		if (![...this.sources.values()].every((s) => s.state === "done")) return false
		// A source can finish while a slower matcher or ranker still processes its last page.
		return this.cancelled || (this.seen.size === this.rows.size + this.rejected && this.prices.size === this.listings.size)
	}
}

/**
 * Shared state every participant can read through resolveRuntime().state.
 */
export class SearchState extends RuntimeState {
	readonly startedAt = Date.now()
	readonly log: LogEntry[] = []
	readonly sessions = new Map<string, Session>()
	/** Per-shop trust, kept across searches: a shop caught faking stays suspect. */
	readonly trust = new Map<string, number>()
	private readonly listeners = new Set<(e: LogEntry) => void>()

	record(entry: Omit<LogEntry, "t">): void {
		const e = { t: Date.now() - this.startedAt, ...entry }
		this.log.push(e)
		if (this.log.length > 5000) this.log.splice(0, 1000)
		for (const l of this.listeners) l(e)
	}

	onRecord(listener: (e: LogEntry) => void): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	session(id: string): Session | undefined {
		return this.sessions.get(id)
	}
}

export const { initializeRuntime, resolveRuntime, resolveParticipant, join, leave, sendEvent } = defineRuntime<SearchState>()

/** Publish an event on the shared environment and log it. */
export function emit<T>(type: string, producerId: string, payload: T): void {
	const runtime = resolveRuntime()
	const searchId = (payload as { searchId?: string })?.searchId
	runtime.state.record({ agent: resolveParticipant(producerId).getManifest().name, kind: "emit", event: type, searchId })
	sendEvent(SemanticEvent.create(type, producerId, payload), producerId)
}
