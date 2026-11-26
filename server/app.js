// Wires the Mozaik runtime: one shared state, seven participants, worker pool and run lifecycle.
import { randomUUID } from "node:crypto";
import { createHuman, SemanticEvent } from "@mozaik-ai/core";
import { runtime, state, CheckerState } from "./runtime.js";
import { bus, now, publicTask } from "./tasks.js";
import { loadDataset } from "./data.js";
import { WorkerPool } from "./worker-pool.js";
import { resolveLlmConfig, buildInferenceRunnerConfig } from "./llm.js";
import { LAW, histRef, offerRef, thirtyDayCheck, trustAudit, N, addDays } from "./rules.js";
import { createPriceFeed } from "./agents/price-feed.js";
import { createThirtyDay } from "./agents/thirty-day.js";
import { createKp } from "./agents/kp.js";
import { createCrossShop } from "./agents/cross-shop.js";
import { createShopTrust } from "./agents/shop-trust.js";
import { createVerdict } from "./agents/verdict.js";
import { createTimeline } from "./agents/timeline.js";

export function createApp({ env = process.env } = {}) {
  const ds = loadDataset();
  const cfg = resolveLlmConfig(env);
  const fallbacks = [];
  runtime.initializeRuntime({
    state: new CheckerState(),
    inferenceRunnerConfig: buildInferenceRunnerConfig(cfg, (e) => { fallbacks.push(String(e?.message || e)); console.warn("[llm] provider error, template fallback:", e?.message || e); }),
  });
  const pool = new WorkerPool(new URL("./compute-worker.js", import.meta.url));

  const shopper = createHuman({ name: "Shopper", capabilities: ["shopping-list"], handlers: [] });
  const timeline = createTimeline();
  const shopTrust = createShopTrust({ pool, cfg, ds });
  const participants = [
    timeline, shopper, createPriceFeed(), createThirtyDay(ds), createKp({ pool, cfg, ds }), createCrossShop(pool), shopTrust,
    createVerdict({ cfg, ds, shopTrust, onVerdict: (run) => updateHeadline(run) }),
  ];
  for (const p of participants) runtime.join(p);

  function updateHeadline(run) {
    const items = [...run.items.values()];
    const done = items.filter((i) => i.verdict);
    const current = items.filter((i) => i.verdict && i.verdict.version === i.version);
    const rows = done.map((i) => {
      const v = i.verdict;
      const rec = v.options.find((o) => o.id === v.recommended);
      const planOpt = rec && rec.kind !== "wait" ? rec : v.options.find((o) => o.kind === "buy-now");
      return {
        productId: i.productId, product: v.product, adRetailer: v.adRetailer,
        fake: v.thirtyDay?.fakeDiscount ?? N(0, [], "no 30-day data"),
        planSaving: planOpt ? N(planOpt.saving.v, planOpt.saving.src, `${planOpt.title}: ${planOpt.saving.f}`) : N(0, [], "no option"),
        planTitle: planOpt?.title ?? null, status: v.thirtyDay?.status,
      };
    });
    const sum = (k) => rows.reduce((a, r) => a + r[k].v, 0);
    run.headline = {
      complete: current.length === items.length && run.feed.done,
      checked: done.length, total: items.length,
      violations: rows.filter((r) => r.status === "likely-violation").length,
      avoided: N(sum("fake"), rows.map((r) => `calc:fake:${r.productId}`), "Σ over the list of (advertised before − max(30-day minimum, BF price))"),
      planSaves: N(sum("planSaving"), rows.map((r) => `calc:plan:${r.productId}`), "Σ over the list of (advertised BF price you saw − price of the recommended buy-now/KP option); negative rows = paying more to avoid a flagged retailer; 'wait' options are not counted"),
      rows,
    };
    if (run.headline.complete && !run.completedAt) {
      run.completedAt = now();
      runtime.sendEvent(SemanticEvent.create("run.completed", shopper.getId(), { runId: run.id, ms: Math.round(run.completedAt - run.startedAt) }), shopper.getId());
    }
    bus.emit(run.id, "headline", run.headline);
  }

  function startRun(listId) {
    const list = ds.lists.find((l) => l.id === listId) || ds.lists[0];
    const run = {
      id: randomUUID().slice(0, 8), listId: list.id, listName: list.name, startedAt: now(), completedAt: null,
      items: new Map(list.items.map(({ productId, retailerId }) => [productId, {
        productId, adRetailerId: retailerId, version: 0, offers: new Map(), thirtyDay: null, crossShop: null,
        kp: { status: "idle" }, verdict: null, verdictStarted: new Set(), verdictHistory: [],
      }])),
      trust: new Map(), tasks: [], log: [], feed: { pagesRead: [], done: false }, headline: null,
    };
    state().runs.set(run.id, run);
    pruneRuns();
    // Kick off after the HTTP response is written; late SSE subscribers get a full snapshot anyway.
    setImmediate(() => runtime.sendMessage(JSON.stringify({ type: "scan", runId: run.id, listId: list.id }), shopper.getId()));
    return run;
  }

  function nextPage(runId) {
    const run = state().runs.get(runId); if (!run) return false;
    run.completedAt = null;
    runtime.sendEvent(SemanticEvent.create("feed.poll.requested", shopper.getId(), { runId }), shopper.getId());
    return true;
  }

  function pruneRuns() {
    const runs = state().runs;
    while (runs.size > 25) {
      const [oldest] = runs.keys(); const run = runs.get(oldest);
      for (const t of run.tasks) { state().tasks.delete(t.id); if (t.loopId) state().loopTasks.delete(t.loopId); }
      runs.delete(oldest);
    }
  }

  function snapshot(runId) {
    const run = state().runs.get(runId); if (!run) return null;
    return {
      id: run.id, listId: run.listId, listName: run.listName, startedAt: run.startedAt, completedAt: run.completedAt, feed: run.feed,
      tasks: run.tasks.map(publicTask), log: run.log.slice(-400), headline: run.headline,
      items: [...run.items.values()].map((i) => ({
        productId: i.productId, product: ds.productById.get(i.productId), adRetailerId: i.adRetailerId, version: i.version,
        adOffer: i.offers.get(i.adRetailerId) || null, thirtyDay: i.thirtyDay?.ad || null,
        kp: i.kp.status === "done" ? { source: i.kp.source, check: i.kp.check, matches: i.kp.matches, rejected: i.kp.rejected, scanned: i.kp.scanned, taskId: i.kp.taskId } : { status: i.kp.status },
        cross: i.crossShop ? { version: i.crossShop.version, rows: i.crossShop.result.rows.map(({ dips, ...r }) => ({ ...r, dips: dips.length })), taskId: i.crossShop.taskId } : null,
        verdict: i.verdict, verdictHistory: i.verdictHistory,
      })),
      trust: [...run.trust.entries()].map(([rid, e]) => ({ retailerId: rid, name: ds.retailerById.get(rid)?.name, status: e.status, ...(e.result || {}) })),
    };
  }

  /** Resolve a source reference to the dataset rows / rule / agent task it points at. */
  function source(ref, runId) {
    const [kind, ...rest] = ref.split(":");
    if (kind === "offer") { const o = ds.offersById.get(rest[0]); return o && { kind, title: `Feed offer ${o.id}`, file: `data/feed/page-${o.page}.json`, row: o, retailer: ds.retailerById.get(o.retailerId)?.name, product: ds.productById.get(o.productId)?.name }; }
    if (kind === "hist") {
      const [rid, pid, date] = rest; const series = ds.history[`${rid}:${pid}`]; if (!series) return null;
      return { kind, title: `Price history: ${ds.productById.get(pid)?.name} @ ${ds.retailerById.get(rid)?.name}`, file: `data/history.json → "${rid}:${pid}"`, highlight: date || null, windowFrom: addDays(ds.meta.bfDate, -30), windowTo: addDays(ds.meta.bfDate, -1), series };
    }
    if (kind === "kp") { const l = ds.kpById.get(rest[0]); return l && { kind, title: `KP listing ${l.id} (synthetic)`, file: "data/kp-listings.json", row: (({ productHint, ...r }) => r)(l) }; }
    if (kind === "rule") return { kind, title: LAW.title, law: LAW };
    if (kind === "audit") { const a = trustAudit(ds.history, rest[0], ds.pages[0], ds.meta.bfDate); return { kind, title: `ShopTrust audit: ${ds.retailerById.get(rest[0])?.name}`, audit: a }; }
    if (kind === "agent") {
      const [agentName, pid] = rest; const run = state().runs.get(runId);
      const t = run?.tasks.filter((x) => x.agent === agentName && x.productId === pid).at(-1);
      return { kind, title: `${agentName} agent output for ${ds.productById.get(pid)?.name ?? pid}`, task: t ? publicTask(t) : null };
    }
    if (kind === "calc") {
      const [what, pid] = rest; const run = state().runs.get(runId); const row = run?.headline?.rows.find((r) => r.productId === pid);
      return row && { kind, title: `${what === "fake" ? "Fake-discount" : "Plan saving"} for ${row.product}`, number: what === "fake" ? row.fake : row.planSaving };
    }
    if (kind === "task") { const t = state().tasks.get(rest[0]); return t && { kind, title: `Task ${t.label}`, task: publicTask(t) }; }
    return null;
  }

  function meta() {
    return {
      mode: cfg.mode, model: cfg.model, provider: cfg.provider ?? null, reason: cfg.reason ?? null, fallbacks: fallbacks.slice(-5),
      workers: pool.size, law: LAW, dataset: ds.meta, lists: ds.lists.map((l) => ({ id: l.id, name: l.name, note: l.note, count: l.items.length })),
      retailers: ds.retailers, products: ds.products,
      agents: state().getParticipants().map((p) => p.getManifest()),
    };
  }

  return { startRun, nextPage, snapshot, source, meta, close: () => pool.close(), cfg };
}
