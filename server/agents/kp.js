// KP: matches a product to KupujemProdajem-style second-hand listings (synthetic corpus).
// Runs a Mozaik agent loop: inference -> search_kp_listings tool (worker-thread search) -> inference -> JSON answer.
// The answer is checked: unknown listing ids are dropped, unparseable answers fall back to template rules.
import { createAgent, SemanticEvent, ModelContext, DeveloperMessageItem } from "@mozaik-ai/core";
import { runtime, state, EventIs, ProducedBySelf, FirstSnapshotOfProduct, pinToolArgs } from "../runtime.js";
import { startTask, endTask } from "../tasks.js";
import { inferenceInput } from "../llm.js";
import { templateKpSelect } from "../templates.js";

const INSTRUCTION = `You are the KP agent in a Black Friday price checker for Serbia. You match a retail product to second-hand listings on a KupujemProdajem-style marketplace (synthetic data).
Always call search_kp_listings first with the given TOOL_ARGS. Then decide which candidates are the SAME product: same brand, model, size/capacity. Reject accessories (cases, cables, filters…), other variants (Pro/Max/Slim, other GB/inch/L) and unrelated items.
Reply with ONLY a JSON object: {"matches":[{"id":"kp-…","reason":"…"}],"rejected":[{"id":"kp-…","reason":"…"}]}. Never invent ids or prices.`;

export function createKp({ pool, cfg, ds }) {
  let agent;
  const searchTool = {
    type: "function", name: "search_kp_listings", strict: false,
    description: "Search the synthetic KupujemProdajem listing corpus for candidates matching a product name. Returns up to 8 candidates with id, title, price (RSD), condition, city, seller rating and similarity score.",
    parameters: { type: "object", properties: { productId: { type: "string" }, query: { type: "string" } }, required: ["productId", "query"], additionalProperties: true },
    async invoke(args) {
      const task = state().tasks.get(args.taskId);
      const r = await pool.run("kpSearch", { query: args.query });
      task?.steps.push({ kind: "worker", start: r.startedAt, end: r.endedAt, label: `scan ${r.result.scanned} listings (worker #${r.worker})` });
      const out = { product: ds.productById.get(args.productId)?.name, ...r.result };
      if (task) task.toolResult = out;
      return out;
    },
  };

  const startMatching = {
    specification: new EventIs("price.observed").and(new FirstSnapshotOfProduct()),
    processor: {
      apply({ event }) {
        const { runId, productId } = event.payload;
        const run = state().runs.get(runId); const item = run.items.get(productId);
        const product = ds.productById.get(productId);
        item.kp.status = "running";
        const task = startTask(run, { agent: "KP", label: `match ${product.name}`, kind: "loop", productId });
        task.model = cfg.mode === "llm" ? cfg.model : "template";
        const context = ModelContext.create().addContextItem(DeveloperMessageItem.create(INSTRUCTION));
        const args = { productId, query: product.name };
        runtime.runLoop(agent.getId(), `[task:${task.id}] Product: ${product.name} (GTIN ${product.gtin}). TOOL_ARGS: ${JSON.stringify(args)}`,
          inferenceInput(cfg, context, [searchTool]), pinToolArgs(task, "search_kp_listings", args));
      },
    },
  };

  const onAnswer = {
    specification: new EventIs("model.answer").and(new ProducedBySelf()),
    processor: {
      apply({ event }) {
        const task = state().tasks.get(state().loopTasks.get(event.payload.loopId)); if (!task) return;
        const run = state().runs.get(task.runId); const item = run.items.get(task.productId);
        const product = ds.productById.get(task.productId);
        const candidates = task.toolResult?.candidates || [];
        const byId = new Map(candidates.map((c) => [c.id, c]));
        let parsed = null, source = cfg.mode === "llm" ? "llm" : "template", check = "ok";
        try { parsed = JSON.parse(/\{[\s\S]*\}/.exec(event.payload.answer.content.text)[0]); } catch { parsed = null; }
        if (!parsed || !Array.isArray(parsed.matches)) { parsed = templateKpSelect(product.name, candidates); source = "template"; check = "answer was not valid JSON — template rules used"; }
        const unknown = parsed.matches.filter((m) => !byId.has(m.id));
        if (unknown.length) check = `dropped ${unknown.length} id(s) not returned by the search tool`;
        const matches = parsed.matches.filter((m) => byId.has(m.id)).map((m) => ({ ...byId.get(m.id), reason: m.reason }));
        item.kp = { status: "done", source, check, matches, rejected: parsed.rejected || [], scanned: task.toolResult?.scanned ?? 0, taskId: task.id };
        endTask(task, "done", { note: `${matches.length} match(es) of ${candidates.length} candidates; ${check}` });
        runtime.sendEvent(SemanticEvent.create("signal.kp", agent.getId(), { runId: run.id, productId: task.productId, matches: matches.length }), agent.getId());
      },
    },
  };

  agent = createAgent({ name: "KP", capabilities: ["second-hand-matching"], instruction: INSTRUCTION, tools: [searchTool], handlers: [startMatching, onAnswer] });
  return agent;
}
