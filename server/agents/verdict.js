// Verdict: turns the other agents' signals into 2-3 actionable options with savings, confidence and risk,
// plus a plain-language explanation. Runs as a Mozaik loop whose compute_options tool call is intercepted
// (and possibly rewritten) by ShopTrust. Answers for an outdated price version are marked superseded.
import { createAgent, SemanticEvent, ModelContext, DeveloperMessageItem } from "@mozaik-ai/core";
import { runtime, state, EventIs, ProducedBySelf, SignalsCompleteForCurrentVersion, VerdictStartedForCurrentVersion, composeInterceptors, pinToolArgs } from "../runtime.js";
import { startTask, endTask, bus } from "../tasks.js";
import { inferenceInput } from "../llm.js";
import { templates } from "../templates.js";
import { buildOptions, numberGuard, collectNumbers } from "../rules.js";
import { trustEntry } from "./shop-trust.js";

const INSTRUCTION = `You are the Verdict agent of a Black Friday discount checker for Serbia (synthetic data, fictional retailers).
First call compute_options with the given TOOL_ARGS. Then write 2-3 short sentences for a shopper: is the advertised discount real under the 30-day lowest-price rule, and which option is best and why.
Rules: use ONLY numbers that appear in the tool output, formatted like "54,999 RSD". Say "likely violation of the 30-day rule", never "illegal". If the tool output has an interception, mention which retailer ShopTrust excluded. No investment or legal advice.`;

export function createVerdict({ cfg, ds, shopTrust, onVerdict }) {
  let agent;
  const name = (rid) => ds.retailerById.get(rid)?.name ?? rid;

  function computeFor(run, item, args, interception) {
    const ctx = {
      product: ds.productById.get(item.productId), adOffer: item.offers.get(item.adRetailerId), thirty: item.thirtyDay.ad,
      cross: item.crossShop.result, kp: item.kp, retailerName: name,
      trust: Object.fromEntries([...run.trust.entries()].filter(([, e]) => e.result).map(([rid, e]) => [rid, { score: e.result.score, flagged: e.result.flagged }])),
    };
    const result = buildOptions(ctx, args);
    let interceptionView = null;
    if (interception) {
      const was = buildOptions(ctx, interception.argsBefore);
      const wasRec = was.options.find((o) => o.id === was.recommended);
      const nowRec = result.options.find((o) => o.id === result.recommended);
      interceptionView = { ...interception, wouldHaveRecommended: wasRec ? { title: wasRec.title, price: wasRec.price } : null, nowRecommended: nowRec ? { title: nowRec.title, price: nowRec.price } : null, changedRecommendation: !!wasRec && !!nowRec && (wasRec.title !== nowRec.title || wasRec.price.v !== nowRec.price.v) };
    }
    return {
      productId: item.productId, product: ctx.product.name, adRetailer: name(item.adRetailerId), adOffer: ctx.adOffer,
      thirtyDay: item.thirtyDay.ad, inputsVersion: item.version, ...result, interception: interceptionView,
    };
  }

  const tool = {
    type: "function", name: "compute_options", strict: false,
    description: "Compute the shopper's options (buy now at the best retailer, buy sealed on KP, wait for a recurring dip) with savings in RSD, confidence and risk, from the ThirtyDay, CrossShop, KP and ShopTrust signals.",
    parameters: { type: "object", properties: { productId: { type: "string" }, version: { type: "number" }, excludeRetailers: { type: "array", items: { type: "string" } } }, required: ["productId", "version"], additionalProperties: true },
    async invoke(args) {
      const task = state().tasks.get(args.taskId);
      const run = state().runs.get(task.runId); const item = run.items.get(task.productId);
      const out = computeFor(run, item, args, task.interception);
      task.toolResult = out;
      return out;
    },
  };

  const start = {
    specification: new EventIs("signal.thirtyDay").or(new EventIs("signal.crossShop")).or(new EventIs("signal.kp"))
      .and(new SignalsCompleteForCurrentVersion())
      .and(new VerdictStartedForCurrentVersion().not()),
    processor: {
      apply({ event }) {
        const run = state().runs.get(event.payload.runId); const item = run.items.get(event.payload.productId);
        const version = item.version;
        item.verdictStarted.add(version);
        const product = ds.productById.get(item.productId);
        const task = startTask(run, { agent: "Verdict", label: `verdict ${product.name} v${version}`, kind: "loop", productId: item.productId, version });
        task.model = cfg.mode === "llm" ? cfg.model : "template";
        const context = ModelContext.create().addContextItem(DeveloperMessageItem.create(INSTRUCTION));
        const args = { productId: item.productId, version, excludeRetailers: [] };
        runtime.runLoop(agent.getId(), `[task:${task.id}] Product: ${product.name}; ad seen at ${name(item.adRetailerId)}. TOOL_ARGS: ${JSON.stringify(args)}`,
          inferenceInput(cfg, context, [tool]),
          composeInterceptors(pinToolArgs(task, "compute_options", { productId: item.productId, version }), shopTrust.interceptVerdict(run, item, task)));
      },
    },
  };

  const onAnswer = {
    specification: new EventIs("model.answer").and(new ProducedBySelf()),
    processor: {
      async apply({ event }) {
        const task = state().tasks.get(state().loopTasks.get(event.payload.loopId)); if (!task) return;
        const run = state().runs.get(task.runId); const item = run.items.get(task.productId);
        if (task.version < item.version || (item.verdict && item.verdict.version > task.version)) {
          endTask(task, "superseded", { note: `price changed to v${item.version} while reasoning; answer discarded` });
          runtime.sendEvent(SemanticEvent.create("verdict.superseded", agent.getId(), { runId: run.id, productId: item.productId, version: task.version, current: item.version }), agent.getId());
          return;
        }
        let out = task.toolResult, check = "ok";
        if (!out) {
          await Promise.all([...item.offers.keys()].map((r) => trustEntry(run, r).promise));
          const flagged = [...item.offers.keys()].filter((r) => trustEntry(run, r).result?.flagged);
          out = computeFor(run, item, { excludeRetailers: flagged }, null); check = "model skipped the tool; options computed by the rules engine";
        }
        let explanation = event.payload.answer.content.text.trim();
        const guard = numberGuard(explanation, collectNumbers(out));
        let explanationSource = cfg.mode === "llm" && check === "ok" ? "llm" : "template";
        if (!guard.ok) { explanation = templates.compute_options(out); explanationSource = "template"; check = `model text rejected by number guard (unsourced: ${guard.bad.join(", ")}); template used`; }
        if (item.verdict) {
          const old = state().tasks.get(item.verdict.taskId);
          if (old) endTask(old, "superseded", { end: old.end, note: `result replaced by v${task.version} after a price change` });
        }
        if (item.verdict) item.verdictHistory.push({ version: item.verdict.version, taskId: item.verdict.taskId, recommended: item.verdict.options.find((o) => o.id === item.verdict.recommended)?.title, status: "superseded" });
        item.verdict = { version: task.version, taskId: task.id, ...out, explanation, explanationSource, check, model: task.model };
        endTask(task, "done", { note: `recommend: ${out.options.find((o) => o.id === out.recommended)?.title ?? "—"}` });
        runtime.sendEvent(SemanticEvent.create("verdict.ready", agent.getId(), { runId: run.id, productId: item.productId, version: task.version }), agent.getId());
        bus.emit(run.id, "items", null);
        onVerdict(run);
      },
    },
  };

  agent = createAgent({ name: "Verdict", capabilities: ["verdict", "explanation"], instruction: INSTRUCTION, tools: [tool], handlers: [start, onAnswer] });
  return agent;
}
