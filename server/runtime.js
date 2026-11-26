// The Mozaik runtime, shared state and the situation specifications the agents compose.
import { defineRuntime, RuntimeState, SituationSpecification, FunctionCallItem } from "@mozaik-ai/core";

/** Shared state every participant reads and writes (the only store; see README "Shared state"). */
export class CheckerState extends RuntimeState {
  runs = new Map();     // runId -> Run (items, trust, tasks, headline)
  tasks = new Map();    // taskId -> Task (every unit of agent work, drawn on the timeline)
  loopTasks = new Map(); // Mozaik loopId -> taskId
}

export const runtime = defineRuntime();
export const state = () => runtime.resolveRuntime().state;

// ---------- Situation specifications (composed with .and / .or / .not) ----------
export class EventIs extends SituationSpecification {
  constructor(...types) { super(); this.types = new Set(types); }
  isSatisfiedBy({ event }) { return this.types.has(event.type); }
}
export class ProducedBySelf extends SituationSpecification {
  isSatisfiedBy({ event, participant }) { return event.producerId === participant.getId(); }
}
export class ProducedByRole extends SituationSpecification {
  constructor(role) { super(); this.role = role; }
  isSatisfiedBy({ event }) { return state().participants.get(event.producerId)?.getManifest().role === this.role; }
}
export class AnyEvent extends SituationSpecification { isSatisfiedBy() { return true; } }

const runOf = (event) => state().runs.get(event.payload?.runId);
const itemOf = (event) => runOf(event)?.items.get(event.payload?.productId);

/** KP only needs to match a product once per run (identity does not change with price). */
export class FirstSnapshotOfProduct extends SituationSpecification {
  isSatisfiedBy({ event }) { const item = itemOf(event); return !!item && item.kp.status === "idle"; }
}
/** Product-scan runs (mobile scanner) vs shopping-list runs. */
export class ScanRun extends SituationSpecification {
  isSatisfiedBy({ event }) { return runOf(event)?.kind === "scan"; }
}
export class FirstScoutOfProduct extends SituationSpecification {
  isSatisfiedBy({ event }) { const item = itemOf(event); return !!item && item.scout?.status === "idle"; }
}
/** ShopTrust audits each retailer once per run. */
export class HasUnauditedRetailer extends SituationSpecification {
  isSatisfiedBy({ event }) { const run = runOf(event); return !!run && (event.payload.offers || []).some((o) => !run.trust.has(o.retailerId)); }
}
/** Check between agents: ThirtyDay, CrossShop and KP have all reported for the product's CURRENT price version. */
export class SignalsCompleteForCurrentVersion extends SituationSpecification {
  isSatisfiedBy({ event }) {
    const item = itemOf(event);
    return !!item && item.thirtyDay?.version === item.version && item.crossShop?.version === item.version && item.kp.status === "done";
  }
}
export class VerdictStartedForCurrentVersion extends SituationSpecification {
  isSatisfiedBy({ event }) { const item = itemOf(event); return !!item && item.verdictStarted.has(item.version); }
}

// ---------- Interception helpers ----------
/** Combine several InterceptionHandlers into one (Mozaik's runLoop takes a single handler). */
export const composeInterceptors = (...handlers) => ({
  isSatisfiedBy: (t) => handlers.some((h) => h.isSatisfiedBy(t)),
  async handle(t) { for (const h of handlers) if (h.isSatisfiedBy(t)) t = await h.handle(t); return t; },
});

export const rewriteCallArgs = (transition, mutate) => {
  const call = transition.input.call;
  const args = (() => { try { return JSON.parse(call.args || "{}"); } catch { return {}; } })();
  const next = mutate({ ...args });
  return { nextStateId: "function_call", input: { ...transition.input, call: FunctionCallItem.rehydrate({ callId: call.callId, name: call.name, args: JSON.stringify(next) }) }, before: args, after: next };
};

/** Guardrail: pin a loop's tool-call arguments to the task it was started for (models can't drift to other ids). */
export const pinToolArgs = (task, toolName, pinned) => ({
  isSatisfiedBy: (t) => t.nextStateId === "function_call" && t.input.call.name === toolName,
  async handle(t) { const r = rewriteCallArgs(t, (a) => ({ ...a, ...pinned, taskId: task.id })); return { nextStateId: r.nextStateId, input: r.input }; },
});
