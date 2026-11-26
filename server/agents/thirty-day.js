// ThirtyDay: applies the 30-day lowest-price rule (Zakon o trgovini čl. 37) to every offer in a snapshot.
// Pure arithmetic over local data: it runs synchronously inside the fan-out (and says so on the timeline).
import { createAgent, SemanticEvent } from "@mozaik-ai/core";
import { runtime, state, EventIs } from "../runtime.js";
import { startTask, endTask } from "../tasks.js";
import { thirtyDayCheck } from "../rules.js";

export function createThirtyDay(ds) {
  let agent;
  agent = createAgent({
    name: "ThirtyDay", capabilities: ["30-day-rule"], tools: [],
    instruction: "Check each offer's advertised 'before' price against the retailer's lowest price in the previous 30 days.",
    handlers: [{
      specification: new EventIs("price.observed"),
      processor: {
        apply({ event }) {
          const { runId, productId, version, offers } = event.payload;
          const run = state().runs.get(runId); const item = run?.items.get(productId); if (!item) return;
          const task = startTask(run, { agent: "ThirtyDay", label: `30-day rule ${productId}`, kind: "sync", productId, version });
          const byRetailer = {};
          for (const o of offers) byRetailer[o.retailerId] = thirtyDayCheck(ds.history[`${o.retailerId}:${productId}`] || [], o, ds.meta.bfDate);
          item.thirtyDay = { version, byRetailer, ad: byRetailer[item.adRetailerId] };
          endTask(task, "done", { note: `ad offer: ${item.thirtyDay.ad?.status}` });
          runtime.sendEvent(SemanticEvent.create("signal.thirtyDay", agent.getId(), { runId, productId, version, status: item.thirtyDay.ad?.status }), agent.getId());
        },
      },
    }],
  });
  return agent;
}
