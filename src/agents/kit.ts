import { createAgent, SemanticEvent, SituationHandler, SituationSpecification } from "@mozaik-ai/core"
import { resolveRuntime } from "../runtime"

// Mozaik's publish() calls every matching handler's apply() without awaiting it,
// so an async handler runs concurrently with every other participant's handler.
// `on` wraps that: it logs start/end for the timeline and catches errors so one
// failing agent never takes the others down.

class EventTypeIs extends SituationSpecification {
	constructor(private readonly types: readonly string[]) {
		super()
	}
	isSatisfiedBy({ event }: { event: SemanticEvent }): boolean {
		return this.types.includes(event.type)
	}
}

export function on<T>(
	types: readonly string[],
	agentName: string,
	run: (payload: T, event: SemanticEvent, selfId: string) => Promise<string | void>,
): SituationHandler {
	return {
		specification: new EventTypeIs(types),
		processor: {
			async apply({ event, participant }) {
				// Yield first, so the publisher's loop finishes handing the event to
				// every participant before any of them starts working.
				await Promise.resolve()
				const state = resolveRuntime().state
				state.record({ agent: agentName, kind: "start", event: event.type })
				try {
					const detail = await run(event.payload as T, event, participant.getId())
					state.record({ agent: agentName, kind: "end", event: event.type, detail: detail ?? undefined })
				} catch (err) {
					state.record({ agent: agentName, kind: "error", event: event.type, detail: String(err) })
				}
			},
		},
	}
}

export function defineAgent(name: string, instruction: string, handlers: SituationHandler[]) {
	return createAgent({ name, capabilities: [], instruction, tools: [], handlers })
}

/** Stand-in for I/O latency (KP lookup, shop API) until the real work exists. */
export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
