// End-to-end test of the no-key (template) mode: starts the server, runs the demo flow, checks the claims
// the README makes (overlap, interception, superseded results, sourced numbers). Run: npm test
import { startServer, runScan, waitComplete, overlaps, check, unsourcedNumbers } from "./test-helpers.js";

const failures = [];
const srv = await startServer(3917, { LLM_MODE: "template" });
try {
  const meta = await fetch(`${srv.base}/api/meta`).then((r) => r.json());
  check(meta.mode === "template", `server is in no-key template mode (${meta.reason})`, failures);
  check(meta.agents.length === 8, `8 Mozaik participants joined: ${meta.agents.map((a) => a.name).join(", ")}`, failures);

  const snap = await runScan(srv.base, "family");
  const ms = Math.round(snap.completedAt - snap.startedAt);
  check(snap.items.every((i) => i.verdict), `all ${snap.items.length} products got a verdict (${ms} ms)`, failures);
  check(snap.items.every((i) => i.verdict.options.length >= 1 && i.verdict.options.length <= 3), "each verdict has 1-3 actionable options", failures);
  check(snap.items.filter((i) => i.verdict.options.length >= 2).length >= snap.items.length / 2, "most verdicts offer 2-3 options", failures);

  const pairs = overlaps(snap.tasks, ["KP", "CrossShop", "ShopTrust", "Verdict", "PriceFeed"]);
  check(pairs.length >= 3, `agents genuinely overlap in time: ${pairs.join(", ")}`, failures);
  const kpOverlap = snap.tasks.filter((t) => t.agent === "KP").some((a) => snap.tasks.some((b) => b.agent === "ShopTrust" && a.start < b.end && b.start < a.end));
  check(kpOverlap, "KP loops and ShopTrust loops run at the same time", failures);
  const workerSpans = snap.tasks.flatMap((t) => t.steps.filter((s) => s.kind === "worker"));
  const parallelWorkers = workerSpans.some((a) => workerSpans.some((b) => a !== b && a.start < b.end && b.start < a.end));
  check(parallelWorkers, `worker-thread jobs executed in parallel (${workerSpans.length} jobs)`, failures);

  const intercepted = snap.items.filter((i) => i.verdict.interception?.changed);
  const changedRec = intercepted.filter((i) => i.verdict.interception.changedRecommendation);
  check(intercepted.length > 0, `ShopTrust interception rewrote ${intercepted.length} Verdict loop(s)`, failures);
  check(changedRec.length > 0, `interception changed the recommendation for: ${changedRec.map((i) => i.product.name).join(", ")}`, failures);

  const unsourced = unsourcedNumbers({ items: snap.items, headline: snap.headline });
  check(unsourced.length === 0, `every number carries a source (${unsourced.slice(0, 3).join(", ") || "ok"})`, failures);
  check(snap.items.every((i) => i.verdict.check === "ok"), "all explanations passed the number guard", failures);
  check(snap.headline.avoided.v > 0, `headline: avoided ${snap.headline.avoided.v} RSD in fake discounts; plan saves ${snap.headline.planSaves.v} RSD`, failures);

  const src = await fetch(`${srv.base}/api/source?ref=${encodeURIComponent(snap.items[0].thirtyDay.min30.src[0])}&run=${snap.id}`).then((r) => r.json());
  check(Array.isArray(src.series), `source endpoint resolves ${snap.items[0].thirtyDay.min30.src[0]}`, failures);

  // late feed page -> affected products re-checked, older verdicts marked superseded
  await fetch(`${srv.base}/api/runs/${snap.id}/next-page`, { method: "POST" });
  const after = await waitComplete(srv.base, snap.id, 3);
  const sup = after.tasks.filter((t) => t.status === "superseded");
  check(sup.length > 0, `after page 3: ${sup.length} task result(s) marked superseded (${sup.map((t) => t.label).join("; ")})`, failures);
  check(after.items.some((i) => i.verdictHistory.length > 0), "re-checked products keep their superseded verdict history", failures);

  const html = await fetch(srv.base + "/").then((r) => r.text());
  check(/Not financial or legal advice/.test(html) && /Synthetic data/.test(html), "UI shows the synthetic-data and not-financial-advice notices", failures);
} catch (e) {
  failures.push(String(e)); console.error(e);
} finally {
  srv.stop();
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nAll checks passed");
process.exit(failures.length ? 1 : 0);
