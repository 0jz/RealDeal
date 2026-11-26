import { defineRuntime, RuntimeState, SemanticEvent } from "@mozaik-ai/core"
import type { Dataset } from "./data/types"
import type { VerdictRecord } from "./agents/events"

export type LogEntry = {
	t: number // ms since the run started
	agent: string
	kind: "emit" | "start" | "end" | "error"
	event: string
	/** Pairs a handler's start with its end/error. */
	run?: number
	detail?: string
}

export const offerKey = (shopId: string, skuId: string) => `${shopId}|${skuId}`

export const INITIAL_TRUST = 100

/**
 * Shared state every participant can read through resolveRuntime().state.
 * Each part has one writer: PriceFeed writes prices, ShopTrustAgent writes
 * trust, VerdictAgent writes verdicts.
 */
export class MarketState extends RuntimeState {
	startedAt = Date.now()
	readonly log: LogEntry[] = []
	/** Current shelf price per offer. Before Black Friday: last day of history, no discount shown. */
	readonly prices = new Map<string, { price: number; shownPrevPrice: number }>()
	readonly trust = new Map<string, number>()
	readonly verdicts = new Map<string, VerdictRecord>()
	private readonly listeners = new Set<(e: LogEntry) => void>()

	constructor(public readonly data: Dataset) {
		super()
		this.reset()
	}

	/** Back to the moment before Black Friday. The runtime itself can only be initialized once. */
	reset(): void {
		this.startedAt = Date.now()
		this.log.length = 0
		this.verdicts.clear()
		for (const o of this.data.offers) {
			const last = o.history[o.history.length - 1] as number
			this.prices.set(offerKey(o.shopId, o.skuId), { price: last, shownPrevPrice: last })
		}
		for (const s of this.data.shops) this.trust.set(s.id, INITIAL_TRUST)
	}

	record(entry: Omit<LogEntry, "t">): void {
		const e = { t: Date.now() - this.startedAt, ...entry }
		this.log.push(e)
		for (const l of this.listeners) l(e)
	}

	onRecord(listener: (e: LogEntry) => void): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}
}

export const { initializeRuntime, resolveRuntime, resolveParticipant, join, leave, sendEvent } =
	defineRuntime<MarketState>()

/** Publish an event on the shared environment and log it. */
export function emit<T>(type: string, producerId: string, payload: T): void {
	const runtime = resolveRuntime()
	runtime.state.record({ agent: resolveParticipant(producerId).getManifest().name, kind: "emit", event: type })
	sendEvent(SemanticEvent.create(type, producerId, payload), producerId)
}
