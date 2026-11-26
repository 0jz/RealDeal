import { defineRuntime, RuntimeState, SemanticEvent } from "@mozaik-ai/core"
import type { Dataset } from "./data/types"

export type LogEntry = {
	t: number // ms since the run started
	agent: string
	kind: "emit" | "start" | "end" | "error"
	event: string
	detail?: string
}

/** Shared state every participant can read through resolveRuntime().state. */
export class MarketState extends RuntimeState {
	readonly startedAt = Date.now()
	readonly log: LogEntry[] = []

	constructor(public readonly data: Dataset) {
		super()
	}

	record(entry: Omit<LogEntry, "t">): void {
		this.log.push({ t: Date.now() - this.startedAt, ...entry })
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
