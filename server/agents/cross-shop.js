// CrossShop: compares the same product (same GTIN) across all fictional retailers, scanning each
// retailer's 60-day history in a worker thread. Results for an outdated price version are discarded.
import { createAgent, SemanticEvent } from "@mozaik-ai/core";
import { runtime, state, EventIs } from "../runtime.js";
import { startTask, endTask } from "../tasks.js";

export function createCrossShop(pool) {
  let agent;
  agent = createAgent({
    name: "CrossShop", capabilities: ["cross-retailer-compare"], tools: [],
    instruction: "Compare the same product across retailers and their price histories.",
    handlers: [{
      specification: new EventIs("price.observed"),
      processor: {
        async apply({ event }) {
          const { runId, productId, version, offers } = event.payload;
          const run = state().runs.get(runId); const item = run?.items.get(productId); if (!item) return;
          const task = startTask(run, { agent: "CrossShop", label: `compare ${productId} v${version}`, kind: "worker", productId, version });
          try {
            const r = await pool.run("crossShop", { productId, offers });
            task.steps.push({ kind: "worker", start: r.startedAt, end: r.endedAt, label: `worker #${r.worker}` });
            if (version < item.version) { endTask(task, "superseded", { note: `price changed to v${item.version} while comparing; result discarded` }); return; }
            item.crossShop = { version, result: r.result, taskId: task.id };
            endTask(task, "done", { note: `${r.result.rows.length} retailers, cheapest ${r.result.cheapestRetailerId}` });
            runtime.sendEvent(SemanticEvent.create("signal.crossShop", agent.getId(), { runId, productId, version }), agent.getId());
          } catch (e) { endTask(task, "error", { note: String(e.message || e) }); }
        },
      },
    }],
  });
  return agent;
}
