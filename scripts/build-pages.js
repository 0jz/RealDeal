// Static export for GitHub Pages: `npm run build:pages`.
// Starts the real server (no-key template mode, deterministic), runs the real agents once — every shopping list
// (including the late feed page), the landing's reference run, and a scan of every product — and writes their
// JSON output plus every source record the pages can open into pages-site/. The pages are the same files as
// public/, marked with <meta name="bfc-static"> so js/common.js answers API calls from the exported JSON.
import { cp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, sleep } from "./test-helpers.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "pages-site");
const DATA = join(OUT, "data");
const port = Number(process.env.PAGES_BUILD_PORT || 3990);
const srv = await startServer(port, { LLM_MODE: "template" });
const get = async (p) => { const r = await fetch(srv.base + p); if (!r.ok) throw new Error(`${p} → ${r.status}`); return r.json(); };
const post = async (p, b) => { const r = await fetch(srv.base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) }); if (!r.ok) throw new Error(`${p} → ${r.status}`); return r.json(); };
const until = async (fn, what) => { for (let i = 0; i < 300; i++) { const v = await fn(); if (v) return v; await sleep(100); } throw new Error(`timed out waiting for ${what}`); };
const write = async (rel, obj) => { await mkdir(dirname(join(DATA, rel)), { recursive: true }); await writeFile(join(DATA, rel), JSON.stringify(obj)); };

// ---------- source refs the pages can open ----------
const REF = /^(offer|hist|kp|rule|audit|calc|agent|task|world|fx|stats|dataset):/;
const RUN_SCOPED = new Set(["calc", "agent", "task", "stats"]);
function refsIn(obj, out = new Set()) {
  if (typeof obj === "string") { if (REF.test(obj)) out.add(obj); return out; }
  if (Array.isArray(obj)) { obj.forEach((x) => refsIn(x, out)); return out; }
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (k === "offerId" && typeof v === "string") out.add("offer:" + v);
      if (k === "taskId" && typeof v === "string") out.add("task:" + v);
      if (k === "retailerId" && typeof v === "string" && "score" in obj) out.add("audit:" + v);
      if (k === "currency" && typeof v === "string" && v !== "RSD") out.add("fx:" + v);
      if (k === "id" && typeof v === "string" && /^(kp-|w-)/.test(v)) out.add((v.startsWith("kp-") ? "kp:" : "world:") + v);
      refsIn(v, out);
    }
  }
  return out;
}
const globalSources = {}; const runSources = {};
async function collect(obj, runId, key = runId) {
  const queue = [...refsIn(obj)];
  if (runId) queue.push(`stats:${runId}`);
  while (queue.length) {
    const ref = queue.pop(); const kind = ref.split(":")[0];
    const bucket = RUN_SCOPED.has(kind) ? (runSources[key] ||= {}) : globalSources;
    if (bucket[ref] || (RUN_SCOPED.has(kind) && !runId)) continue;
    const r = await fetch(`${srv.base}/api/source?ref=${encodeURIComponent(ref)}&run=${runId ?? ""}`);
    if (!r.ok) continue;
    bucket[ref] = await r.json();
    for (const x of refsIn(bucket[ref])) if (!(RUN_SCOPED.has(x.split(":")[0]) ? runSources[key]?.[x] : globalSources[x])) queue.push(x);
  }
}

try {
  await rm(OUT, { recursive: true, force: true });
  await cp(join(ROOT, "public"), OUT, { recursive: true });
  await writeFile(join(OUT, ".nojekyll"), "");
  let commit = "unknown";
  try { commit = execSync("git rev-parse --short HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch {}
  const repo = process.env.GITHUB_REPOSITORY ? `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${process.env.GITHUB_REPOSITORY}` : process.env.PAGES_REPO_URL || "";
  for (const f of (await readdir(OUT)).filter((f) => f.endsWith(".html"))) {
    const html = await readFile(join(OUT, f), "utf8");
    await writeFile(join(OUT, f), html.replace("<head>", `<head>\n  <meta name="bfc-static" content="1" />${repo ? `\n  <meta name="bfc-repo" content="${repo}" />` : ""}`));
  }

  const meta = await get("/api/meta");
  const summary = await until(async () => { const s = await get("/api/summary"); return s.reference.complete && s; }, "reference run");
  await write("meta.json", meta); await write("summary.json", summary); await write("products.json", await get("/api/products"));
  await collect(summary, summary.reference.runId);
  await collect({ ref: meta.law.id, dataset: "dataset:" }, null);

  const index = { recordedAt: new Date().toISOString(), commit, mode: meta.mode, lists: {}, scans: {}, nextPage: [], reference: summary.reference.runId };
  // shopping lists: the reference run serves the "all" list; the late feed page is recorded for every list run
  for (const l of meta.lists) {
    const runId = l.id === summary.reference.list || l.id === "all" ? summary.reference.runId : (await post("/api/runs", { listId: l.id })).runId;
    const before = await until(async () => { const s = await get(`/api/runs/${runId}`); return s.headline?.complete && s; }, `run ${l.id}`);
    await write(`runs/${runId}.json`, before); await collect(before, runId);
    await post(`/api/runs/${runId}/next-page`);
    const after = await until(async () => { const s = await get(`/api/runs/${runId}`); return s.headline?.complete && s.feed.pagesRead.includes(3) && s; }, `next page ${l.id}`);
    await write(`runs/${runId}.next-page.json`, after); await collect(after, runId, `${runId}.next-page`); // own source map: calc/stats values after the late page
    index.lists[l.id] = runId; index.nextPage.push(runId);
    console.log(`list ${l.id}: run ${runId} (${before.tasks.length} → ${after.tasks.length} tasks)`);
  }
  // one scan per product (the scanner looks these up client-side by EAN-13 / name)
  for (const p of meta.products) {
    const { runId } = await post("/api/scans", { code: p.ean13 });
    const scan = await until(async () => { const s = await get(`/api/scans/${runId}`); return s.complete && s; }, `scan ${p.id}`);
    const snap = await get(`/api/runs/${runId}`);
    await write(`scans/${runId}.json`, scan); await write(`runs/${runId}.json`, snap);
    await collect(scan, runId); await collect(snap, runId);
    index.scans[p.id] = runId;
  }
  console.log(`scans: ${Object.keys(index.scans).length} products`);
  await write("sources/global.json", globalSources);
  for (const [runId, m] of Object.entries(runSources)) await write(`sources/run-${runId}.json`, m);
  await write("index.json", index);
  console.log(`sources: ${Object.keys(globalSources).length} global, ${Object.values(runSources).reduce((a, m) => a + Object.keys(m).length, 0)} run-scoped`);
  console.log(`pages-site/ written (commit ${commit}${repo ? ", repo " + repo : ""})`);
} finally {
  srv.stop();
}
