// Worker thread: real CPU work off the main event loop (KP search, cross-shop history scan,
// retailer audit). Several of these run in parallel, which is why timeline bars overlap.
import { parentPort, workerData, threadId } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { loadDataset } from "./data.js";
import { crossShopCompare, trustAudit } from "./rules.js";

const now = () => performance.timeOrigin + performance.now();
const ds = loadDataset();

const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const trigrams = (s) => { const t = new Set(); const x = `  ${norm(s)} `; for (let i = 0; i < x.length - 2; i++) t.add(x.slice(i, i + 3)); return t; };
const index = ds.kp.map((l) => ({ l, g: trigrams(l.title), tokens: new Set(norm(l.title).split(" ")) }));

function kpSearch({ query }) {
  const q = trigrams(query);
  const qTokens = norm(query).split(" ");
  const scored = [];
  for (const { l, g, tokens } of index) {
    let inter = 0;
    for (const t of q) if (g.has(t)) inter++;
    const jaccard = inter / (q.size + g.size - inter);
    const tokenCover = qTokens.filter((t) => tokens.has(t)).length / qTokens.length;
    const score = 0.5 * jaccard + 0.5 * tokenCover;
    if (score > 0.3) scored.push({ ...l, score: Math.round(score * 1000) / 1000 });
  }
  scored.sort((a, b) => b.score - a.score);
  return { query, scanned: index.length, candidates: scored.slice(0, 8).map(({ productHint, ...rest }) => rest) };
}

const handlers = {
  kpSearch,
  crossShop: ({ productId, offers }) => crossShopCompare(ds.history, productId, offers, ds.meta.bfDate),
  trustAudit: ({ retailerId }) => trustAudit(ds.history, retailerId, ds.pages[0], ds.meta.bfDate),
};

parentPort.on("message", ({ id, type, args }) => {
  const startedAt = now();
  try {
    const result = handlers[type](args);
    parentPort.postMessage({ id, ok: true, result, startedAt, endedAt: now(), threadId });
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: String(e?.stack || e), startedAt, endedAt: now(), threadId });
  }
});
parentPort.postMessage({ ready: true, threadId, workerIndex: workerData?.index });
