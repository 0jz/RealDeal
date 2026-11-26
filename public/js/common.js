// Shared by every page (site, scanner, barcodes, "under the hood" demo): sourced-number rendering and the
// source drawer. Pages never compute or hardcode figures; they render sourced numbers {v, unit, src[], f}
// returned by the server and every one opens its sources when clicked.
export const $ = (s, root = document) => root.querySelector(s);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const rsd = (v) => Math.round(v).toLocaleString("en-US") + " RSD";
export const fmtInt = (v) => Number(v).toLocaleString("en-US");
const liveApi = async (path, opts) => { const r = await fetch(path, opts); if (!r.ok) throw Object.assign(new Error((await r.json().catch(() => ({}))).error || r.statusText), { status: r.status }); return r.json(); };

// ---------- static snapshot mode (GitHub Pages) ----------
// `npm run build:pages` exports a recorded engine run into pages-site/data/ and marks every page with
// <meta name="bfc-static">. The same API paths are then answered from those JSON files (relative URLs, so it
// works under https://<user>.github.io/<repo>/). Nothing is computed here: only lookups in exported engine output.
export const STATIC = typeof document !== "undefined" && !!document.querySelector('meta[name="bfc-static"]');
const jcache = new Map();
const notFound = (what) => Object.assign(new Error(`${what} is not in the static snapshot`), { status: 404 });
export function staticJson(p) {
  if (!jcache.has(p)) jcache.set(p, fetch(p).then((r) => { if (!r.ok) throw notFound(p); return r.json(); }));
  return jcache.get(p);
}
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]+/g, " ").trim();
/** Same matching as the server's findProducts (server/app.js): EAN-13/GTIN exact, else name tokens. */
export function findProducts(products, q) {
  const raw = String(q || "").trim();
  if (!raw) return products;
  const digits = raw.replace(/\D/g, "");
  const byCode = products.filter((p) => p.ean13 === digits || p.gtin === raw.toUpperCase());
  if (byCode.length) return byCode;
  const tokens = norm(raw).split(" ").filter(Boolean);
  return products.map((p) => ({ p, score: tokens.filter((t) => norm(p.name + " " + p.category).includes(t)).length / tokens.length }))
    .filter((x) => x.score >= 0.5).sort((a, b) => b.score - a.score).map((x) => x.p);
}
async function staticApi(path, method = "GET", body = {}) {
  const [p, qs] = path.split("?"); const q = new URLSearchParams(qs || ""); let m;
  const idx = await staticJson("data/index.json");
  if (p === "/api/meta") return staticJson("data/meta.json");
  if (p === "/api/summary") return staticJson("data/summary.json");
  if (p === "/api/products") return findProducts(await staticJson("data/products.json"), q.get("q"));
  if (p === "/api/runs" && method === "POST") { const id = idx.lists[body.listId]; if (!id) throw notFound("list"); return { runId: id }; }
  if (p === "/api/scans" && method === "POST") {
    const code = String(body.code || body.q || "").trim();
    const product = code && findProducts(await staticJson("data/products.json"), code)[0];
    if (!product) throw notFound("product");
    return { runId: idx.scans[product.id], product };
  }
  if ((m = /^\/api\/runs\/([\w-]+)$/.exec(p))) return staticJson(`data/runs/${m[1]}.json`);
  if ((m = /^\/api\/scans\/([\w-]+)$/.exec(p))) return staticJson(`data/scans/${m[1]}.json`);
  if (p === "/api/source") {
    const ref = q.get("ref"), run = q.get("run");
    const g = await staticJson("data/sources/global.json"); if (g[ref]) return g[ref];
    if (run) { const r = await staticJson(`data/sources/run-${run}.json`).catch(() => ({})); if (r[ref]) return r[ref]; }
    throw notFound(ref);
  }
  throw notFound(path);
}
export const api = (path, opts) => (STATIC ? staticApi(path, opts?.method, opts?.body ? JSON.parse(opts.body) : {}) : liveApi(path, opts));
if (STATIC) {
  const repo = document.querySelector('meta[name="bfc-repo"]')?.content;
  staticJson("data/index.json").then((idx) => {
    document.body.insertAdjacentHTML("afterbegin", `<div class="static-banner" role="note"><b>Static snapshot of a real engine run</b> (recorded ${esc(idx.recordedAt.slice(0, 16).replace("T", " "))} UTC, engine commit ${esc(idx.commit)}) — live agents run with <code>npm start</code> (see ${repo ? `<a href="${esc(repo)}">the repo</a>` : "the repo"}).</div>`);
  }).catch(() => {});
}
export const post = (path, body) => api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });

/** Page context: meta (retailers/products for labels) and the run the drawer resolves refs against. */
export const ctx = { meta: null, getRunId: () => "" };
export const nums = new Map(); let numSeq = 0;

export function num(n, { signed = false, cls = "", plain = false } = {}) {
  if (!n) return "—";
  const id = "n" + ++numSeq; nums.set(id, n);
  const txt = n.unit === "%" ? `${n.v}%` : n.unit === "count" ? fmtInt(n.v) : signed && n.v < 0 ? "−" + rsd(Math.abs(n.v)) : signed && n.v > 0 ? "+" + rsd(n.v) : rsd(n.v);
  return `<a href="#" class="num ${plain ? "plain" : ""} ${cls}" data-num="${id}" title="${esc(n.f)} — click for sources">${esc(txt)}</a>`;
}
export const srcLink = (ref, label) => `<a href="#" class="src" data-ref="${esc(ref)}">${esc(label ?? ref)}</a>`;

function ensureDrawer() {
  if ($("#drawer")) return;
  document.body.insertAdjacentHTML("beforeend", `<div id="drawer" class="drawer hidden" aria-hidden="true">
    <div class="drawer-head"><h3 id="drawer-title">Source</h3><button id="drawer-close" aria-label="Close">×</button></div>
    <div id="drawer-body" class="drawer-body"></div></div>`);
}
export function openDrawer(title, html) { ensureDrawer(); $("#drawer-title").textContent = title; $("#drawer-body").innerHTML = html; $("#drawer").classList.remove("hidden"); }

export async function openSource(ref) {
  const s = await api(`/api/source?ref=${encodeURIComponent(ref)}&run=${ctx.getRunId() ?? ""}`).catch(() => null);
  if (!s) return openDrawer(ref, `<p>Source not found.</p>`);
  openDrawer(s.title, renderSource(s, ref));
}
export function renderSource(s) {
  const file = s.file ? `<p class="muted">Dataset: <code>${esc(s.file)}</code> (synthetic)</p>` : "";
  if (s.kind === "offer" || s.kind === "kp") return file + kv(s.row) + (s.retailer ? `<p>${esc(s.retailer)} · ${esc(s.product)}</p>` : "");
  if (s.kind === "world" || s.kind === "fx" || s.kind === "dataset" || s.kind === "stats") return file + kv(s.row) + (s.note ? `<p class="warn-t">${esc(s.note)}</p>` : "") + (s.kind === "fx" && ctx.fxSource ? `<p><a href="${esc(ctx.fxSource)}" target="_blank" rel="noopener">Official NBS exchange rate list</a> (for comparison; not used live)</p>` : "");
  if (s.kind === "hist") return file + chart(s) + `<table class="tbl"><tr><th>Date</th><th>Price</th></tr>${s.series.slice(-35).reverse().map((r) => `<tr class="${r.d === s.highlight ? "hl" : ""} ${r.d >= s.windowFrom ? "" : "dim"}"><td>${r.d}</td><td>${rsd(r.p)}</td></tr>`).join("")}</table>`;
  if (s.kind === "rule") { const L = s.law; return `<blockquote>${esc(L.quote)}</blockquote><p>${esc(L.translation)}</p><p>${L.urls.map((u) => `<a href="${u}" target="_blank" rel="noopener">${esc(u)}</a>`).join("<br>")}</p><p class="muted">${esc(L.context)}</p><p class="warn-t"><b>Unverified:</b> ${esc(L.unverified)}</p>`; }
  if (s.kind === "audit") { const a = s.audit; return `<p><b>${a.score}/100</b> ${a.flagged ? "(flagged)" : ""}</p><p class="muted">${esc(a.formula)}</p><table class="tbl"><tr><th>Offer</th><th>Before</th><th>30-day min</th><th>BF</th><th>Status</th></tr>${a.checks.map((c) => `<tr><td>${srcLink("offer:" + c.offerId, c.offerId)}</td><td>${c.before ? rsd(c.before) : "—"}</td><td>${c.min30 ? rsd(c.min30) : "—"}</td><td>${c.bf ? rsd(c.bf) : "—"}</td><td>${esc(c.status)}</td></tr>`).join("")}</table>`; }
  if (s.kind === "calc") return numberHtml(s.number);
  if (s.kind === "task" || s.kind === "agent") {
    const t = s.task; if (!t) return "<p>No task yet.</p>";
    return `${kv({ agent: t.agent, label: t.label, kind: t.kind, status: t.status, version: t.version, model: t.model, "duration (ms)": t.end ? (t.end - t.start).toFixed(2) : "running", loopId: t.loopId, note: t.note })}
      <h4>Steps</h4><table class="tbl">${(t.steps || []).map((x) => `<tr><td>${esc(x.kind)}</td><td>${esc(x.label)}</td><td>${x.end ? (x.end - x.start).toFixed(2) + " ms" : "…"}</td></tr>`).join("")}</table>
      ${t.interception ? `<h4>ShopTrust interception</h4><p>Waited ${t.interception.waitedMs} ms; flagged: ${esc(t.interception.flaggedNames.join(", ") || "none")}</p><p class="muted">compute_options arguments before → after:</p><pre>${esc(JSON.stringify(t.interception.argsBefore, null, 1))}</pre><pre>${esc(JSON.stringify(t.interception.argsAfter, null, 1))}</pre>` : ""}`;
  }
  return `<pre>${esc(JSON.stringify(s, null, 2))}</pre>`;
}
export function numberHtml(n) {
  const big = n.unit === "%" ? n.v + "%" : n.unit === "count" ? fmtInt(n.v) : rsd(n.v);
  return `<p class="bignum">${big}</p><p><b>How:</b> ${esc(n.f)}</p><h4>Sources</h4><ul>${n.src.map((r) => `<li>${srcLink(r, describeRef(r))}</li>`).join("") || "<li>none</li>"}</ul>`;
}
export function describeRef(r) {
  const [k, a, b, c] = r.split(":");
  const m = ctx.meta || { retailers: [], products: [] };
  const R = (id) => m.retailers.find((x) => x.id === id)?.name ?? id, P = (id) => m.products.find((x) => x.id === id)?.name ?? id;
  return k === "offer" ? `feed offer ${a}` : k === "hist" ? `price history ${P(b)} @ ${R(a)}${c ? " on " + c : ""}` : k === "kp" ? `KP listing ${a}` : k === "rule" ? "Zakon o trgovini čl. 37"
    : k === "audit" ? `ShopTrust audit of ${R(a)}` : k === "agent" ? `${a} agent output for ${P(b)}` : k === "calc" ? `${a === "fake" ? "fake-discount" : "plan saving"} for ${P(b)}`
    : k === "world" ? `synthetic world reference price ${a}` : k === "fx" ? `approximate exchange rate ${a} → RSD` : k === "stats" ? `timeline statistics of run ${a}` : k === "dataset" ? "dataset summary" : k === "task" ? `agent task ${a}` : r;
}
export function kv(o) { return `<table class="tbl">${Object.entries(o).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(typeof v === "number" && k.toLowerCase().includes("price") && !("currency" in o && o.currency !== "RSD") ? rsd(v) : typeof v === "object" ? JSON.stringify(v) : v)}</td></tr>`).join("")}</table>`; }
export function chart(s) {
  const W = 420, H = 140, pts = s.series, min = Math.min(...pts.map((p) => p.p)) * 0.97, max = Math.max(...pts.map((p) => p.p)) * 1.02;
  const x = (i) => (i / (pts.length - 1)) * W, y = (v) => H - ((v - min) / (max - min)) * H;
  const wi = pts.findIndex((p) => p.d >= s.windowFrom);
  const hi = pts.findIndex((p) => p.d === s.highlight);
  return `<svg viewBox="0 0 ${W} ${H + 18}" class="chart"><rect x="${x(Math.max(0, wi))}" y="0" width="${W - x(Math.max(0, wi))}" height="${H}" class="win"/><text x="${x(Math.max(0, wi)) + 4}" y="12" class="wt">30-day window</text>
    <polyline points="${pts.map((p, i) => `${x(i)},${y(p.p)}`).join(" ")}" class="line"/>${hi >= 0 ? `<circle cx="${x(hi)}" cy="${y(pts[hi].p)}" r="4" class="pt"/>` : ""}
    <text x="0" y="${H + 14}" class="wt">${pts[0].d}</text><text x="${W}" y="${H + 14}" text-anchor="end" class="wt">${pts.at(-1).d}</text></svg>`;
}

/** Click handling for sourced numbers and source links (installed once per page). */
export function installSourceClicks(extra) {
  ensureDrawer();
  document.addEventListener("click", (e) => {
    if (e.target.closest("#drawer-close")) { $("#drawer").classList.add("hidden"); return; }
    const n = e.target.closest("[data-num]"); if (n) { e.preventDefault(); const obj = nums.get(n.dataset.num); if (obj) openDrawer("Where this number comes from", numberHtml(obj)); return; }
    const s = e.target.closest("[data-ref]"); if (s) { e.preventDefault(); openSource(s.dataset.ref); return; }
    extra?.(e);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#drawer")?.classList.add("hidden"); });
}

export const STATUS = {
  "likely-violation": ["bad", "Likely violation of the 30-day rule"], "real-discount": ["good", "Real discount"],
  "no-real-discount": ["warn", "No real discount vs 30-day low"], "no-discount-claimed": ["neutral", "No discount advertised"],
  "insufficient-history": ["neutral", "Not enough history"],
};
export function statusBadge(td) { const [cls, label] = STATUS[td?.status] || ["neutral", td?.status ?? "…"]; return `<span class="badge ${cls}">${esc(label)}</span>`; }
export function modePill(m) {
  return m.mode === "llm" ? `<span class="mode llm">LLM mode · <b>${esc(m.model)}</b></span>` : `<span class="mode tpl" title="${esc(m.reason)}"><b>No-key template mode</b> · explanations from templates</span>`;
}
