// PriceScout (product scanner): a Mozaik agent loop that runs in parallel with ThirtyDay, KP, CrossShop,
// ShopTrust and Verdict on a "scan" run. Its price_reference tool computes, in a worker thread, the average
// current price across the (fictional) Serbian retailers, their 30-day average, and the average of the
// SYNTHETIC world reference prices converted to RSD with approximate fixed rates.
import { createAgent, SemanticEvent, ModelContext, DeveloperMessageItem } from "@mozaik-ai/core";
import { runtime, state, EventIs, ProducedBySelf, ScanRun, pinToolArgs } from "../runtime.js";
import { startTask, endTask, bus } from "../tasks.js";
import { inferenceInput } from "../llm.js";
import { numberGuard, collectNumbers } from "../rules.js";
import { scoutTemplate } from "../templates.js";

const INSTRUCTION = `You are the PriceScout agent. Call price_reference with the given TOOL_ARGS, then summarise in one or two sentences how the Serbian average compares with the world reference average and which offer is cheapest.
Use ONLY numbers from the tool output, formatted like "54,999 RSD". All prices are synthetic and the retailers fictional. No financial advice.`;

export function createPriceScout({ pool, cfg, ds, onDone }) {
  let agent;
  const compute = async (task, item) => {
    const r = await pool.run("priceScout", { productId: item.productId, offers: [...item.offers.values()] });
    task.steps.push({ kind: "worker", start: r.startedAt, end: r.endedAt, label: `price reference (worker #${r.worker})` });
    return { ...r.result, product: ds.productById.get(item.productId).name, cheapestName: ds.retailerById.get(r.result.cheapest.retailerId)?.name, inputsVersion: item.version };
  };
  const tool = {
    type: "function", name: "price_reference", strict: false,
    description: "Average current price of a product across Serbian retailers in the synthetic feed, its 30-day average, synthetic world reference prices converted to RSD, and the cheapest current offer.",
    parameters: { type: "object", properties: { productId: { type: "string" } }, required: ["productId"], additionalProperties: true },
    async invoke(args) {
      const task = state().tasks.get(args.taskId);
      const item = state().runs.get(task.runId).items.get(task.productId);
      task.toolResult = await compute(task, item);
      return task.toolResult;
    },
  };

  function startScout(run, item) {
    item.scout = { status: "running" };
    const product = ds.productById.get(item.productId);
    const task = startTask(run, { agent: "PriceScout", label: `price reference ${product.name}`, kind: "loop", productId: item.productId });
    task.model = cfg.mode === "llm" ? cfg.model : "template";
    const args = { productId: item.productId };
    runtime.runLoop(agent.getId(), `[task:${task.id}] Product: ${product.name} (EAN ${product.ean13}). TOOL_ARGS: ${JSON.stringify(args)}`,
      inferenceInput(cfg, ModelContext.create().addContextItem(DeveloperMessageItem.create(INSTRUCTION)), [tool]), pinToolArgs(task, "price_reference", args));
  }

  agent = createAgent({
    name: "PriceScout", capabilities: ["price-reference", "scanner"], instruction: INSTRUCTION, tools: [tool],
    handlers: [
      {
        // Starts once the feed (incl. late updates) is read, so the averages use the final Black Friday prices.
        specification: new EventIs("feed.completed").and(new ScanRun()),
        processor: {
          apply({ event }) {
            const run = state().runs.get(event.payload.runId);
            for (const item of run.items.values()) if (item.scout?.status === "idle") startScout(run, item);
          },
        },
      },
      {
        specification: new EventIs("model.answer").and(new ProducedBySelf()),
        processor: {
          async apply({ event }) {
            const task = state().tasks.get(state().loopTasks.get(event.payload.loopId)); if (!task) return;
            const run = state().runs.get(task.runId); const item = run.items.get(task.productId);
            let out = task.toolResult, check = "ok";
            if (!out) { out = await compute(task, item); check = "model skipped the tool; computed directly"; }
            let summary = String(event.payload.answer?.content?.text ?? "").trim();
            const guard = numberGuard(summary, collectNumbers(out));
            if (!summary || !guard.ok) { summary = scoutTemplate(out); if (check === "ok") check = `model text rejected by number guard (unsourced: ${(guard.bad || []).join(", ")}); template used`; }
            item.scout = { status: "done", ...out, summary, summarySource: cfg.mode === "llm" && check === "ok" ? "llm" : "template", check, taskId: task.id };
            endTask(task, "done", { note: `SR avg ${out.serbia.avgNow.v} RSD${out.world ? `, world avg ${out.world.avg.v} RSD` : ""}` });
            runtime.sendEvent(SemanticEvent.create("signal.priceScout", agent.getId(), { runId: run.id, productId: task.productId }), agent.getId());
            bus.emit(run.id, "items", null);
            onDone?.(run);
          },
        },
      },
    ],
  });
  return agent;
}
