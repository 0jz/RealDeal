// ShopTrust: audits each fictional retailer's pricing behaviour (worker thread) in a Mozaik loop, and
// owns the InterceptionHandler that Verdict loops run with: before a Verdict executes its compute_options
// tool call, the handler waits for the relevant audits and REWRITES the call's input to exclude flagged
// retailers. One agent changes another agent's in-flight reasoning.
import { createAgent, SemanticEvent, ModelContext, DeveloperMessageItem } from "@mozaik-ai/core";
import { runtime, state, EventIs, ProducedBySelf, HasUnauditedRetailer, pinToolArgs, rewriteCallArgs } from "../runtime.js";
import { startTask, endTask, updateTask, now } from "../tasks.js";
import { inferenceInput } from "../llm.js";
import { templates } from "../templates.js";
import { numberGuard, collectNumbers } from "../rules.js";

const INSTRUCTION = `You are the ShopTrust agent. Call audit_retailer with the given TOOL_ARGS, then explain the retailer's trust score in 1-2 sentences for a shopper.
Use ONLY numbers that appear in the tool output. Say "likely violation of the 30-day rule", never "illegal" or "fraud". The data is synthetic and the retailer fictional.`;

function deferred() { let resolve; const promise = new Promise((r) => (resolve = r)); return { promise, resolve }; }

export function trustEntry(run, retailerId) {
  if (!run.trust.has(retailerId)) run.trust.set(retailerId, { status: "pending", ...deferred(), result: null, taskId: null });
  return run.trust.get(retailerId);
}

export function createShopTrust({ pool, cfg, ds }) {
  let agent;
  const auditTool = {
    type: "function", name: "audit_retailer", strict: false,
    description: "Audit one retailer: compares every Black Friday offer's advertised 'before' price with the retailer's own 30-day minimum and counts pre-Black-Friday price hikes. Returns counts, a 0-100 trust score and whether it is flagged.",
    parameters: { type: "object", properties: { retailerId: { type: "string" } }, required: ["retailerId"], additionalProperties: true },
    async invoke(args) {
      const task = state().tasks.get(args.taskId);
      const r = await pool.run("trustAudit", { retailerId: args.retailerId });
      task?.steps.push({ kind: "worker", start: r.startedAt, end: r.endedAt, label: `audit ${r.result.offersAudited} offers (worker #${r.worker})` });
      const out = { retailerName: ds.retailerById.get(args.retailerId)?.name, ...r.result };
      if (task) task.toolResult = out;
      return out;
    },
  };

  const startAudits = {
    specification: new EventIs("price.observed").and(new HasUnauditedRetailer()),
    processor: {
      apply({ event }) {
        const run = state().runs.get(event.payload.runId);
        for (const { retailerId } of event.payload.offers) {
          const entry = trustEntry(run, retailerId);
          if (entry.taskId) continue;
          const task = startTask(run, { agent: "ShopTrust", label: `audit ${ds.retailerById.get(retailerId).name}`, kind: "loop", retailerId });
          task.model = cfg.mode === "llm" ? cfg.model : "template";
          entry.taskId = task.id;
          const context = ModelContext.create().addContextItem(DeveloperMessageItem.create(INSTRUCTION));
          const args = { retailerId };
          runtime.runLoop(agent.getId(), `[task:${task.id}] Retailer: ${ds.retailerById.get(retailerId).name}. TOOL_ARGS: ${JSON.stringify(args)}`,
            inferenceInput(cfg, context, [auditTool]), pinToolArgs(task, "audit_retailer", args));
        }
      },
    },
  };

  const onAnswer = {
    specification: new EventIs("model.answer").and(new ProducedBySelf()),
    processor: {
      async apply({ event }) {
        const task = state().tasks.get(state().loopTasks.get(event.payload.loopId)); if (!task) return;
        const run = state().runs.get(task.runId);
        const entry = trustEntry(run, task.retailerId);
        let audit = task.toolResult;
        let check = "ok";
        if (!audit) { audit = { retailerName: ds.retailerById.get(task.retailerId).name, ...(await pool.run("trustAudit", { retailerId: task.retailerId })).result }; check = "model skipped the tool; audit run directly"; }
        let rationale = event.payload.answer.content.text.trim();
        const guard = numberGuard(rationale, collectNumbers(audit));
        if (!guard.ok) { rationale = templates.audit_retailer(audit); check = `model text rejected by number guard (unsourced: ${guard.bad.join(", ")}); template used`; }
        entry.result = { ...audit, rationale, rationaleSource: check === "ok" && cfg.mode === "llm" ? "llm" : "template", check, taskId: task.id };
        entry.status = "done";
        entry.resolve(entry.result);
        endTask(task, "done", { note: `score ${audit.score}/100${audit.flagged ? " — FLAGGED" : ""}` });
        runtime.sendEvent(SemanticEvent.create(audit.flagged ? "trust.flagged" : "trust.assessed", agent.getId(), { runId: run.id, retailerId: task.retailerId, score: audit.score, flagged: audit.flagged }), agent.getId());
      },
    },
  };

  /** InterceptionHandler factory used by Verdict loops. */
  agent = createAgent({ name: "ShopTrust", capabilities: ["retailer-trust", "interception"], instruction: INSTRUCTION, tools: [auditTool], handlers: [startAudits, onAnswer] });
  agent.interceptVerdict = (run, item, task) => ({
    isSatisfiedBy: (t) => t.nextStateId === "function_call" && t.input.call.name === "compute_options",
    async handle(t) {
      const retailers = [...item.offers.keys()];
      const pending = retailers.filter((r) => trustEntry(run, r).status !== "done");
      const waitStart = now();
      if (pending.length) updateTask(task, { note: `waiting for ShopTrust: ${pending.map((r) => ds.retailerById.get(r).name).join(", ")}` });
      const results = await Promise.all(retailers.map((r) => trustEntry(run, r).promise));
      const flagged = results.filter((r) => r.flagged).map((r) => r.retailerId);
      const trust = Object.fromEntries(results.map((r) => [r.retailerId, { score: r.score, flagged: r.flagged }]));
      const rw = rewriteCallArgs(t, (a) => ({ ...a, excludeRetailers: [...new Set([...(a.excludeRetailers || []), ...flagged])], trust }));
      task.interception = {
        by: "ShopTrust", at: now(), waitedMs: Math.round(now() - waitStart), waitedFor: pending,
        flagged, flaggedNames: flagged.map((r) => ds.retailerById.get(r).name),
        changed: flagged.length > 0, argsBefore: rw.before, argsAfter: rw.after,
      };
      task.steps.push({ kind: "interception", start: waitStart, end: now(), label: flagged.length ? `ShopTrust rewrote input: exclude ${task.interception.flaggedNames.join(", ")}` : "ShopTrust check passed" });
      updateTask(task, { note: flagged.length ? `intercepted by ShopTrust` : task.note });
      return { nextStateId: rw.nextStateId, input: rw.input };
    },
  });
  return agent;
}
