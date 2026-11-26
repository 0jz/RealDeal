// Site test: the public site (landing, checker, scanner) must show exactly what the engine computed.
// Recomputes every landing/scan figure independently from the run snapshot, the source endpoint and the
// data files, and checks that the site's HTML/JS contain no hardcoded figures. Run: npm run test:site
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, sleep, check, unsourcedNumbers } from "./test-helpers.js";
import { runStats } from "../server/rules.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = (f) => JSON.parse(readFileSync(join(ROOT, "data", f), "utf8"));
const failures = [];
const srv = await startServer(3918, { LLM_MODE: "template" });
const get = (p) => fetch(srv.base + p).then((r) => r.json());
const post = (p, b) => fetch(srv.base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
const mean = (xs) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

try {
  // ---------- landing: /api/summary ----------
  let s; for (let i = 0; i < 100; i++) { s = await get("/api/summary"); if (s.reference.complete) break; await sleep(100); }
  check(s.reference.complete, `landing reference run completed (${s.reference.listName})`, failures);
  const snap = await get(`/api/runs/${s.reference.runId}`);
  check(same(s.reference.headline, snap.headline), "landing headline === the engine's run headline (same object)", failures);
  const avoided = snap.items.reduce((a, i) => a + (i.thirtyDay?.fakeDiscount?.v ?? 0), 0);
  const plan = snap.items.reduce((a, i) => { const o = i.verdict.options.find((x) => x.id === i.verdict.recommended); return a + (o && o.kind !== "wait" ? o.saving.v : 0); }, 0);
  check(s.reference.headline.avoided.v === avoided, `landing "avoided" ${avoided} RSD = Σ fake discounts recomputed from the items`, failures);
  check(s.reference.headline.planSaves.v === plan, `landing "best plan saves" ${plan} RSD = Σ recommended savings recomputed from the verdicts`, failures);
  const viol = snap.items.filter((i) => i.thirtyDay?.status === "likely-violation").length;
  check(s.reference.headline.violations === viol && s.reference.headline.checked === snap.items.length, `landing "${viol} of ${snap.items.length}" matches the ThirtyDay results`, failures);
  check(same(s.reference.stats, runStats(snap.tasks, snap.startedAt, snap.completedAt)), `landing agent stats recomputed from the task records (peak ${s.reference.stats.peakConcurrency}, ${s.reference.stats.tasks} tasks)`, failures);
  const trustSnap = Object.fromEntries(snap.trust.map((t) => [t.retailerId, t.score]));
  check(s.reference.trust.length === snap.trust.length && s.reference.trust.every((t) => trustSnap[t.retailerId] === t.score), "landing trust scores === ShopTrust results of the run", failures);
  const topFake = Math.max(...snap.items.map((i) => i.thirtyDay?.fakeDiscount?.v ?? 0));
  check(s.reference.spotlight?.thirtyDay.fakeDiscount.v === topFake, `spotlight is the ad with the largest fake discount (${topFake} RSD)`, failures);
  const hist = data("history.json"), pages = [1, 2, 3].map((n) => data(`feed/page-${n}.json`));
  const d = s.dataset;
  check(d.retailers === data("retailers.json").length && d.products === data("products.json").length && d.kpListings === data("kp-listings.json").length
    && d.historyRows === Object.values(hist).reduce((a, x) => a + x.length, 0) && d.feedOffers === pages[0].length && d.lateUpdates === pages[1].length + pages[2].length
    && d.worldPriceRows === data("world-prices.json").length, "dataset counts on the landing match the data files", failures);
  check(s.agents.length === 7 && s.participants === 9, `landing lists ${s.agents.length} agents (${s.agents.map((a) => a.name).join(", ")})`, failures);
  check(unsourcedNumbers(s).length === 0, "every money figure in /api/summary carries a source", failures);

  // ---------- scanner ----------
  const products = data("products.json"), world = data("world-prices.json"), fx = data("fx-rates.json");
  check((await post("/api/scans", { code: "0000000000000" })).status === 404, "unknown barcode → 404 (no invented product)", failures);
  const byName = await (await post("/api/scans", { q: "sonar headphones" })).json();
  check(byName.product?.id === "p06", "manual search by name finds the product", failures);
  for (const p of [products[0], products[1], products[5], products[8]]) {
    const { runId } = await (await post("/api/scans", { code: p.ean13 })).json();
    let r; for (let i = 0; i < 100; i++) { r = await get(`/api/scans/${runId}`); if (r.complete) break; await sleep(100); }
    const rs = await get(`/api/runs/${runId}`); const it = rs.items[0];
    const offers = await Promise.all(r.serbia.avgNow.src.map((ref) => get(`/api/source?ref=${encodeURIComponent(ref)}&run=${runId}`)));
    const srAvg = mean(offers.map((o) => o.row.bfPrice));
    const wrows = world.filter((w) => w.productId === p.id);
    const wAvg = mean(wrows.map((w) => Math.round(w.price * fx.rates[w.currency])));
    const cheapest = Math.min(...offers.map((o) => o.row.bfPrice));
    const rec = it.verdict.options.find((o) => o.id === it.verdict.recommended);
    const ok = r.complete && r.product.id === p.id && r.serbia.avgNow.v === srAvg && r.world.avg.v === wAvg && r.cheapestOverall.price.v === cheapest
      && r.best.price.v === rec.price.v && r.best.title === rec.title && r.savings.bestVsSerbiaAvg.v === srAvg - rec.price.v
      && r.serbiaVsWorld.v === srAvg - wAvg && rs.tasks.some((t) => t.agent === "PriceScout" && t.status === "done");
    check(ok, `scan ${p.ean13} (${p.name}): SR avg ${r.serbia.avgNow.v}, world avg ${r.world.avg.v}, best "${r.best.title}" ${r.best.price.v} RSD, cheapest ${r.cheapestOverall.price.v} — all recomputed from sources`, failures);
    check(unsourcedNumbers(r).length === 0, `  every scan figure carries a source`, failures);
    const loops = rs.tasks.filter((t) => t.kind === "loop" && t.end);
    const scout = loops.find((t) => t.agent === "PriceScout");
    check(loops.some((t) => t !== scout && t.start < scout.end && scout.start < t.end), "  PriceScout loop overlaps other agents' loops", failures);
  }
  const wsrc = await get(`/api/source?ref=world:${world[0].id}`), fxsrc = await get("/api/source?ref=fx:EUR");
  check(wsrc.row?.price === world[0].price && /Synthetic/.test(wsrc.note) && fxsrc.row?.rsdPerUnit === fx.rates.EUR, "world:/fx: sources resolve and are labelled synthetic/approximate", failures);

  // ---------- no hardcoded figures in the site ----------
  const files = ["index.html", "site.js", "scan.html", "scan.js", "barcodes.html"];
  const hard = files.flatMap((f) => [...readFileSync(join(ROOT, "public", f), "utf8").matchAll(/\b\d[\d.,]*\s?(RSD|EUR|din)\b|\b\d{2,3}(,\d{3})+\b/g)].map((m) => `${f}: ${m[0]}`));
  check(hard.length === 0, `site pages contain no hardcoded money figures${hard.length ? ": " + hard.join("; ") : ""}`, failures);
  for (const page of ["/", "/scan.html", "/barcodes.html", "/demo.html"]) {
    const html = await fetch(srv.base + page).then((r) => r.text());
    check(/Not financial/.test(html) && /[Ss]ynthetic/.test(html), `${page} shows the synthetic-data and not-financial-advice notices`, failures);
  }
} catch (e) {
  failures.push(String(e)); console.error(e);
} finally {
  srv.stop();
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nAll checks passed");
process.exit(failures.length ? 1 : 0);
