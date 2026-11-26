// PriceFeed: replays the synthetic Black Friday feed (page by page, async file reads) and publishes
// one `price.observed` event per product snapshot. Each snapshot bumps the product's price version.
import { readFile } from "node:fs/promises";
import { createAgent, SemanticEvent } from "@mozaik-ai/core";
import { runtime, state, EventIs, ProducedByRole } from "../runtime.js";
import { startTask, endTask, updateTask, bus } from "../tasks.js";
import { feedPagePath } from "../data.js";

export function createPriceFeed() {
  let agent;
  async function readPage(run, page) {
    const task = startTask(run, { agent: "PriceFeed", label: `read feed page ${page}`, kind: "io" });
    const rows = JSON.parse(await readFile(feedPagePath(page), "utf8"));
    const mine = rows.filter((o) => run.items.has(o.productId));
    const byProduct = new Map();
    for (const o of mine) {
      const item = run.items.get(o.productId);
      item.offers.set(o.retailerId, o);
      byProduct.set(o.productId, item);
    }
    run.feed.pagesRead.push(page);
    endTask(task, "done", { note: `${rows.length} rows read, ${mine.length} relevant to this list` });
    for (const item of byProduct.values()) {
      item.version += 1;
      // anything still running for an older version will be discarded when it finishes
      for (const t of run.tasks) if (t.productId === item.productId && t.status === "running" && t.version !== null && t.version < item.version) updateTask(t, { stale: true });
      runtime.sendEvent(SemanticEvent.create("price.observed", agent.getId(), {
        runId: run.id, productId: item.productId, version: item.version, page, offers: [...item.offers.values()],
      }), agent.getId());
    }
    runtime.sendEvent(SemanticEvent.create("feed.page.read", agent.getId(), { runId: run.id, page, rows: rows.length, relevant: mine.length }), agent.getId());
    bus.emit(run.id, "items", null);
  }

  const onScanRequested = {
    specification: new EventIs("message.sent").and(new ProducedByRole("human")),
    processor: {
      async apply({ event }) {
        let msg; try { msg = JSON.parse(event.payload.message); } catch { return; }
        if (msg.type !== "scan") return;
        const run = state().runs.get(msg.runId); if (!run) return;
        try {
          await readPage(run, 1);
          await readPage(run, 2); // late updates published after midnight (synthetic)
          run.feed.done = true;
          runtime.sendEvent(SemanticEvent.create("feed.completed", agent.getId(), { runId: run.id }), agent.getId());
        } catch (e) { console.error("[PriceFeed]", e); }
      },
    },
  };
  const onPollRequested = {
    specification: new EventIs("feed.poll.requested"),
    processor: {
      async apply({ event }) {
        const run = state().runs.get(event.payload.runId); if (!run) return;
        const next = Math.max(...run.feed.pagesRead) + 1;
        if (next > 3) return;
        try { await readPage(run, next); } catch (e) { console.error("[PriceFeed]", e); }
      },
    },
  };
  agent = createAgent({
    name: "PriceFeed", capabilities: ["price-feed"], tools: [],
    instruction: "Publish Black Friday price snapshots from the synthetic retailer feed.",
    handlers: [onScanRequested, onPollRequested],
  });
  return agent;
}
