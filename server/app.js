// Wires the Mozaik runtime: one shared state, seven participants, worker pool and run lifecycle.
import { randomUUID } from "node:crypto";
import { createHuman, SemanticEvent } from "@mozaik-ai/core";
import { runtime, state, CheckerState } from "./runtime.js";
import { bus, now, publicTask } from "./tasks.js";
import { loadDataset } from "./data.js";
import { WorkerPool } from "./worker-pool.js";
import { resolveLlmConfig, buildInferenceRunnerConfig } from "./llm.js";
import { LAW, histRef, offerRef, thirtyDayCheck, trustAudit, N, addDays, runStats } from "./rules.js";
import { createPriceFeed } from "./agents/price-feed.js";
import { createThirtyDay } from "./agents/thirty-day.js";
import { createKp } from "./agents/kp.js";
import { createCrossShop } from "./agents/cross-shop.js";
import { createShopTrust } from "./agents/shop-trust.js";
import { createVerdict } from "./agents/verdict.js";
import { createTimeline } from "./agents/timeline.js";
import { createPriceScout } from "./agents/price-scout.js";

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
    createPriceScout({ pool, cfg, ds, onDone: (run) => updateHeadline(run) }),
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
      complete: current.length === items.length && run.feed.done && (run.kind !== "scan" || items.every((i) => i.scout?.status === "done")),
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

  function startRun(listId, scanProduct = null) {
    const list = scanProduct
      ? { id: `scan:${scanProduct.id}`, name: `Scan: ${scanProduct.name}`, items: [{ productId: scanProduct.id, retailerId: scanProduct.featuredRetailer }] }
      : ds.lists.find((l) => l.id === listId) || ds.lists[0];
    const kind = scanProduct ? "scan" : "list";
    const run = {
      id: randomUUID().slice(0, 8), kind, listId: list.id, listName: list.name, startedAt: now(), completedAt: null,
      items: new Map(list.items.map(({ productId, retailerId }) => [productId, {
        productId, adRetailerId: retailerId, version: 0, offers: new Map(), thirtyDay: null, crossShop: null,
        kp: { status: "idle" }, verdict: null, verdictStarted: new Set(), verdictHistory: [],
        scout: kind === "scan" ? { status: "idle" } : null,
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
      id: run.id, kind: run.kind, listId: run.listId, listName: run.listName, startedAt: run.startedAt, completedAt: run.completedAt, feed: run.feed,
      tasks: run.tasks.map(publicTask), log: run.log.slice(-400), headline: run.headline, stats: runStats(run.tasks, run.startedAt, run.completedAt),
      items: [...run.items.values()].map((i) => ({
        productId: i.productId, product: ds.productById.get(i.productId), adRetailerId: i.adRetailerId, version: i.version,
        adOffer: i.offers.get(i.adRetailerId) || null, thirtyDay: i.thirtyDay?.ad || null,
        kp: i.kp.status === "done" ? { source: i.kp.source, check: i.kp.check, matches: i.kp.matches, rejected: i.kp.rejected, scanned: i.kp.scanned, taskId: i.kp.taskId } : { status: i.kp.status },
        cross: i.crossShop ? { version: i.crossShop.version, rows: i.crossShop.result.rows.map(({ dips, ...r }) => ({ ...r, dips: dips.length })), taskId: i.crossShop.taskId } : null,
        verdict: i.verdict, verdictHistory: i.verdictHistory, scout: i.scout,
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
    if (kind === "world") { const w = ds.worldById.get(rest[0]); return w && { kind, title: `Synthetic world reference price ${w.id}`, file: "data/world-prices.json", row: w, note: "Synthetic reference price generated from a fixed seed — not a real market price." }; }
    if (kind === "fx") { const cur = rest[0]; return { kind, title: `Exchange rate ${cur} → RSD (approximate)`, file: "data/fx-rates.json", row: { currency: cur, rsdPerUnit: ds.fx.rates[cur], asOf: ds.fx.asOf }, note: ds.fx.note }; }
    if (kind === "dataset") return { kind, title: "Dataset summary", row: datasetSummary(), note: ds.meta.note };
    if (kind === "stats") { const run = state().runs.get(rest[0]); return run && { kind, title: `Timeline statistics of run ${run.id}`, row: runStats(run.tasks, run.startedAt, run.completedAt), note: "Computed by server/rules.js runStats() from the run's task records (the same records the timeline draws)." }; }
    if (kind === "task") { const t = state().tasks.get(rest[0]); return t && { kind, title: `Task ${t.label}`, task: publicTask(t) }; }
    return null;
  }

  function datasetSummary() {
    return {
      retailers: ds.retailers.length, products: ds.products.length,
      historyRows: Object.values(ds.history).reduce((a, x) => a + x.length, 0), historyFrom: ds.meta.historyFrom, historyTo: ds.meta.historyTo,
      feedPages: ds.pages.length, feedOffers: ds.pages[0].length, lateUpdates: ds.pages.slice(1).reduce((a, p) => a + p.length, 0),
      kpListings: ds.kp.length, worldPriceRows: ds.world.length, worldMarkets: new Set(ds.world.map((w) => w.market)).size,
      bfDate: ds.meta.bfDate, seed: ds.meta.seed, synthetic: true,
    };
  }

  /** The reference run: the full feed ("all" list) checked by the agents. The landing page reads its numbers. */
  function referenceRun() {
    let run = [...state().runs.values()].reverse().find((r) => r.kind === "list" && r.listId === "all");
    if (!run) run = startRun("all");
    return run;
  }

  function summary() {
    const run = referenceRun();
    const agents = state().getParticipants().map((p) => p.getManifest());
    // Spotlight: the ad with the largest fake-discount part in the reference run (picked server-side).
    const done = [...run.items.values()].filter((i) => i.thirtyDay?.ad && i.verdict && i.verdict.version === i.version);
    const top = done.sort((a, b) => (b.thirtyDay.ad.fakeDiscount?.v ?? 0) - (a.thirtyDay.ad.fakeDiscount?.v ?? 0))[0];
    const spotlight = top && {
      product: ds.productById.get(top.productId), adRetailer: top.verdict.adRetailer, thirtyDay: top.thirtyDay.ad,
      recommended: top.verdict.options.find((o) => o.id === top.verdict.recommended) ?? null,
    };
    return {
      mode: cfg.mode, model: cfg.model, reason: cfg.reason ?? null, law: LAW, dataset: datasetSummary(),
      agents: agents.filter((a) => a.role === "agent"), participants: agents.length,
      reference: {
        runId: run.id, listName: run.listName, complete: !!run.headline?.complete, spotlight, headline: run.headline, stats: runStats(run.tasks, run.startedAt, run.completedAt),
        trust: [...run.trust.entries()].filter(([, e]) => e.result).map(([rid, e]) => ({ retailerId: rid, name: ds.retailerById.get(rid)?.name, score: e.result.score, flagged: e.result.flagged, violations: e.result.violations, offersAudited: e.result.offersAudited })),
      },
    };
  }

  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]+/g, " ").trim();
  function findProducts(q) {
    const raw = String(q || "").trim();
    if (!raw) return ds.products;
    const digits = raw.replace(/\D/g, "");
    const byCode = ds.products.filter((p) => p.ean13 === digits || p.gtin === raw.toUpperCase());
    if (byCode.length) return byCode;
    const tokens = norm(raw).split(" ").filter(Boolean);
    return ds.products.map((p) => ({ p, score: tokens.filter((t) => norm(p.name + " " + p.category).includes(t)).length / tokens.length }))
      .filter((x) => x.score >= 0.5).sort((a, b) => b.score - a.score).map((x) => x.p);
  }
  function startScan(q) {
    const product = findProducts(q)[0];
    if (!product || !String(q || "").trim()) return null;
    return { run: startRun(null, product), product };
  }

  /** What the mobile scanner shows: every figure is a sourced number from PriceScout, CrossShop and Verdict. */
  function scanResult(runId) {
    const snap = snapshot(runId); if (!snap || snap.kind !== "scan") return null;
    const it = snap.items[0], v = it.verdict, sc = it.scout?.status === "done" ? it.scout : null;
    const best = v ? v.options.find((o) => o.id === v.recommended) : null;
    const buyNow = v ? v.options.find((o) => o.kind === "buy-now") : null;
    const name = (rid) => ds.retailerById.get(rid)?.name ?? rid;
    const vsAvg = (opt, avg, label) => opt && avg ? N(avg.v - opt.price.v, [...new Set([...opt.price.src, ...avg.src])], `${label} − ${opt.title} price`) : null;
    const flaggedCheapest = sc && v ? (v.interception?.flagged || []).includes(sc.cheapest.retailerId) : false;
    return {
      runId, complete: !!snap.headline?.complete, product: it.product, stats: snap.stats, tasks: snap.tasks,
      serbia: sc?.serbia ?? null, world: sc?.world ?? null, serbiaVsWorld: sc?.serbiaVsWorld ?? null,
      cheapestOverall: sc ? { ...sc.cheapest, retailer: name(sc.cheapest.retailerId), flagged: flaggedCheapest } : null,
      best: best ? { title: best.title, kind: best.kind, price: best.price, confidence: best.confidence, risk: best.risk, why: v.why } : null,
      bestNew: buyNow ? { title: buyNow.title, price: buyNow.price, retailerId: buyNow.retailerId } : null,
      savings: {
        bestVsSerbiaAvg: vsAvg(best, sc?.serbia.avgNow, "Serbian average"),
        bestNewVsSerbiaAvg: vsAvg(buyNow, sc?.serbia.avgNow, "Serbian average"),
        bestVsWorldAvg: vsAvg(best, sc?.world?.avg, "world reference average"),
      },
      thirtyDay: it.thirtyDay, adRetailer: v?.adRetailer ?? name(it.adRetailerId), options: v?.options ?? [],
      explanation: v?.explanation ?? null, explanationSource: v?.explanationSource ?? null,
      scoutSummary: sc?.summary ?? null, scoutSummarySource: sc?.summarySource ?? null, interception: v?.interception ?? null,
    };
  }

  function meta() {
    return {
      mode: cfg.mode, model: cfg.model, provider: cfg.provider ?? null, reason: cfg.reason ?? null, fallbacks: fallbacks.slice(-5),
      workers: pool.size, law: LAW, dataset: ds.meta, lists: ds.lists.map((l) => ({ id: l.id, name: l.name, note: l.note, count: l.items.length })),
      retailers: ds.retailers, products: ds.products,
      agents: state().getParticipants().map((p) => p.getManifest()),
    };
  }

  return { startRun, nextPage, snapshot, source, meta, summary, findProducts, startScan, scanResult, datasetSummary, close: () => pool.close(), cfg };
}
