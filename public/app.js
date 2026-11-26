// Single-file frontend: no build step. Talks to the Node server over REST + Server-Sent Events.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rsd = (v) => Math.round(v).toLocaleString("en-US") + " RSD";
const AGENTS = ["PriceFeed", "ThirtyDay", "KP", "CrossShop", "ShopTrust", "Verdict"];
const AGENT_INFO = {
  PriceFeed: "reads the synthetic feed (async file I/O)", ThirtyDay: "30-day rule, sync arithmetic", KP: "LLM loop + worker search",
  CrossShop: "worker: same GTIN across shops", ShopTrust: "LLM loop + worker audit; intercepts Verdict", Verdict: "LLM loop: options + explanation",
};

let meta = null, run = null, es = null, refetchTimer = null, renderQueued = false;
const nums = new Map(); let numSeq = 0;

// ---------- sourced numbers ----------
function num(n, { signed = false, cls = "" } = {}) {
  if (!n) return "—";
  const id = "n" + ++numSeq; nums.set(id, n);
  const txt = n.unit === "%" ? `${n.v}%` : signed && n.v < 0 ? "−" + rsd(Math.abs(n.v)) : rsd(n.v);
  return `<a href="#" class="num ${cls}" data-num="${id}" title="${esc(n.f)} — click for sources">${esc(txt)}</a>`;
}
const srcLink = (ref, label) => `<a href="#" class="src" data-ref="${esc(ref)}">${esc(label ?? ref)}</a>`;

// ---------- boot ----------
async function boot() {
  meta = await fetch("/api/meta").then((r) => r.json());
  $("#list").innerHTML = meta.lists.map((l) => `<option value="${l.id}">${esc(l.name)} (${l.count} items)</option>`).join("");
  $("#mode").className = "mode " + (meta.mode === "llm" ? "llm" : "tpl");
  $("#mode").innerHTML = meta.mode === "llm"
    ? `LLM mode · <b>${esc(meta.model)}</b>`
    : `<b>No-key template mode</b> · ${esc(meta.reason)} — explanations come from templates, not an LLM`;
  const L = meta.law;
  $("#law").innerHTML = `<p><b>Rule checked:</b> ${srcLink(L.id, L.title)} — “${esc(L.translation)}” ${L.urls.map((u, i) => `<a href="${u}" target="_blank" rel="noopener">[${i + 1}]</a>`).join(" ")}</p><p class="muted">${esc(L.context)} <b>Unverified:</b> ${esc(L.unverified)}</p>`;
  const q = new URLSearchParams(location.search);
  if (q.get("list")) $("#list").value = q.get("list");
  if (q.get("run")) attach(q.get("run")); else if (q.has("autorun")) startRun();
}

async function startRun() {
  $("#run").disabled = true;
  const { runId } = await fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ listId: $("#list").value }) }).then((r) => r.json());
  history.replaceState(null, "", `?run=${runId}`);
  attach(runId);
}

function attach(runId) {
  es?.close();
  es = new EventSource(`/api/runs/${runId}/stream`);
  es.addEventListener("snapshot", (e) => { run = JSON.parse(e.data); $("#list").value = run.listId; renderAll(); });
  es.addEventListener("task", (e) => {
    if (!run) return; const t = JSON.parse(e.data);
    const i = run.tasks.findIndex((x) => x.id === t.id); i >= 0 ? (run.tasks[i] = t) : run.tasks.push(t);
    queueRender();
  });
  es.addEventListener("log", (e) => { if (!run) return; run.log.push(JSON.parse(e.data)); appendLog(JSON.parse(e.data)); });
  es.addEventListener("headline", (e) => { if (!run) return; run.headline = JSON.parse(e.data); renderHeadline(); refetch(); });
  es.addEventListener("items", () => refetch());
  es.onerror = () => { $("#status").textContent = "Connection lost — reload to reconnect."; };
}

function refetch() {
  clearTimeout(refetchTimer);
  refetchTimer = setTimeout(async () => {
    const s = await fetch(`/api/runs/${run.id}`).then((r) => r.json());
    run.items = s.items; run.trust = s.trust; run.headline = s.headline; run.feed = s.feed; run.completedAt = s.completedAt;
    renderAll(false);
  }, 60);
}
function queueRender() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; renderTimeline(); renderStatus(); }); }

function renderAll(withLog = true) {
  nums.clear();
  renderStatus(); renderHeadline(); renderTimeline(); renderCards(); renderTrust();
  if (withLog) { $("#log").innerHTML = ""; run.log.forEach(appendLog); }
}

function renderStatus() {
  if (!run) return;
  const done = run.headline?.complete;
  const running = run.tasks.filter((t) => t.status === "running").length;
  $("#status").innerHTML = done
    ? `Run <code>${run.id}</code> complete in ${Math.round(run.completedAt - run.startedAt)} ms · feed pages read: ${run.feed.pagesRead.join(", ")}`
    : `Run <code>${run.id}</code> in progress · ${running} task(s) running`;
  $("#run").disabled = !done && running > 0;
  $("#next").disabled = !done || Math.max(0, ...run.feed.pagesRead) >= 3;
}

// ---------- headline ----------
function renderHeadline() {
  const h = run?.headline; const el = $("#headline");
  if (!h) { el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
  el.innerHTML = `
    <div class="big"><span>You avoided</span> ${num(h.avoided, { cls: "hl-red" })} <span>in fake discounts</span></div>
    <div class="big"><span>Best plan saves</span> ${num(h.planSaves, { cls: h.planSaves.v >= 0 ? "hl-green" : "hl-red" })} <span>vs. the ads you saw</span></div>
    <div class="hl-meta">${h.violations} of ${h.checked} checked ads are a <b>likely violation of the 30-day rule</b> · ${h.checked}/${h.total} products checked${h.complete ? "" : " (in progress)"} ·
      <a href="#" id="breakdown">breakdown</a></div>`;
  $("#breakdown").onclick = (e) => { e.preventDefault(); openBreakdown(); };
}
function openBreakdown() {
  const h = run.headline;
  openDrawer("Headline breakdown", `
    <p class="muted">${esc(h.avoided.f)}</p><p class="muted">${esc(h.planSaves.f)}</p>
    <table class="tbl"><tr><th>Product</th><th>Ad at</th><th>Fake part</th><th>Plan</th><th>Plan saving</th></tr>
    ${h.rows.map((r) => `<tr><td>${esc(r.product)}</td><td>${esc(r.adRetailer)}</td><td>${num(r.fake)}</td><td>${esc(r.planTitle ?? "—")}</td><td>${num(r.planSaving, { signed: true })}</td></tr>`).join("")}
    <tr class="sum"><td colspan="2">Total</td><td>${num(h.avoided)}</td><td></td><td>${num(h.planSaves, { signed: true })}</td></tr></table>`);
}

// ---------- timeline ----------
function renderTimeline() {
  if (!run) return;
  const el = $("#timeline");
  const t0 = run.startedAt;
  const ends = run.tasks.map((t) => (t.end ?? performance.timeOrigin + performance.now()) - t0);
  const span = Math.max(10, ...ends) * 1.04;
  const pctX = (abs) => ((abs - t0) / span) * 100;
  const lanes = AGENTS.map((agent) => {
    const tasks = run.tasks.filter((t) => t.agent === agent).sort((a, b) => a.start - b.start);
    const rows = [];
    for (const t of tasks) {
      const end = t.end ?? Infinity;
      let r = rows.findIndex((rowEnd) => rowEnd <= t.start - span * 0.002);
      if (r < 0) { rows.push(end); r = rows.length - 1; } else rows[r] = end;
      t._row = r;
    }
    const height = Math.max(1, rows.length);
    const bars = tasks.map((t) => {
      const endAbs = t.end ?? t0 + span / 1.04;
      const left = pctX(t.start), width = Math.max(0.25, pctX(endAbs) - left);
      const segs = (t.steps || []).map((s) => {
        const sl = ((s.start - t.start) / Math.max(0.001, endAbs - t.start)) * 100;
        const sw = (((s.end ?? endAbs) - s.start) / Math.max(0.001, endAbs - t.start)) * 100;
        return `<i class="seg seg-${s.kind}" style="left:${sl}%;width:${Math.max(0.5, sw)}%" title="${esc(s.label)}: ${((s.end ?? endAbs) - s.start).toFixed(1)} ms"></i>`;
      }).join("");
      const dur = ((t.end ?? endAbs) - t.start).toFixed(1);
      const cls = [`bar`, `k-${t.kind}`, `s-${t.status}`, t.stale ? "stale" : "", t.interception?.changed ? "intercepted" : ""].join(" ");
      return `<div class="${cls}" data-task="${t.id}" style="left:${left}%;width:${width}%;top:${t._row * 22}px" title="${esc(t.label)} · ${dur} ms · ${esc(t.status)}${t.note ? " · " + esc(t.note) : ""}">${segs}<span>${esc(t.label)}${t.status === "superseded" ? " (superseded)" : ""}${t.interception?.changed ? " ⚡" : ""}</span></div>`;
    }).join("");
    return `<div class="lane"><div class="lane-name"><b>${agent}</b><small>${AGENT_INFO[agent]}</small></div><div class="lane-track" style="height:${height * 22 + 4}px">${bars}</div></div>`;
  }).join("");
  const step = niceStep(span / 8);
  const ticks = []; for (let x = 0; x <= span; x += step) ticks.push(`<span style="left:${(x / span) * 100}%">${x < 1000 ? Math.round(x) + " ms" : (x / 1000).toFixed(1) + " s"}</span>`);
  el.innerHTML = `${lanes}<div class="axis"><div class="lane-name"></div><div class="ticks">${ticks.join("")}</div></div>`;
  const asyncTasks = run.tasks.filter((t) => t.kind !== "sync");
  const ev = asyncTasks.flatMap((t) => [[t.start, 1], [t.end ?? Infinity, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let c = 0, peak = 0; for (const [, d] of ev) { c += d; peak = Math.max(peak, c); }
  const sup = run.tasks.filter((t) => t.status === "superseded").length;
  const inter = run.tasks.filter((t) => t.interception?.changed).length;
  $("#tl-stats").innerHTML = `<span>peak concurrency <b>${peak}</b> async tasks</span><span><b>${run.tasks.length}</b> tasks</span><span><b>${sup}</b> superseded</span><span><b>${inter}</b> Verdict loops rewritten by ShopTrust</span>`;
}
function niceStep(x) { const p = 10 ** Math.floor(Math.log10(x)); return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= x); }

// ---------- product cards ----------
const STATUS = {
  "likely-violation": ["bad", "Likely violation of the 30-day rule"], "real-discount": ["good", "Real discount"],
  "no-real-discount": ["warn", "No real discount vs 30-day low"], "no-discount-claimed": ["neutral", "No discount advertised"],
  "insufficient-history": ["neutral", "Not enough history"],
};
function renderCards() {
  const el = $("#cards");
  if (!run?.items?.length) return;
  el.innerHTML = run.items.map((it) => {
    const p = it.product, v = it.verdict, td = it.thirtyDay, ad = it.adOffer;
    const ret = (rid) => meta.retailers.find((r) => r.id === rid)?.name ?? rid;
    if (!v) return `<article class="pcard pending"><h3>${esc(p.name)}</h3><p class="muted">Ad seen at ${esc(ret(it.adRetailerId))} · waiting for agents…</p>${td ? statusBadge(td) : ""}</article>`;
    const [cls] = STATUS[td?.status] || ["neutral"];
    const inter = v.interception;
    return `<article class="pcard st-${cls}">
      <div class="pc-head"><div><h3>${esc(p.name)}</h3><p class="muted">${esc(p.category)} · GTIN ${esc(p.gtin)} · ad seen at <b>${esc(v.adRetailer)}</b></p></div>${statusBadge(td)}</div>
      <div class="ad">${td?.advertisedBefore ? `<s>${num(td.advertisedBefore)}</s> → ` : ""}${num(td?.bfPrice)} ${td?.advertisedBefore ? `<span class="claimed">claimed −${num(td.claimedPct)}</span>` : ""}</div>
      <ul class="facts">
        <li>Lowest price in the ${esc(td?.rule)} window: ${num(td?.min30)} <span class="muted">(${esc(td?.minDate)})</span> ${srcLink(meta.law.id, "čl. 37")}</li>
        <li>Real discount vs that minimum: ${num(td?.realDiscount, { signed: true })} (${num(td?.realPct)})</li>
        ${td?.fakeDiscount?.v > 0 ? `<li class="bad-t">Fake part of the advertised saving: ${num(td.fakeDiscount)}</li>` : ""}
      </ul>
      ${inter?.changed ? `<div class="inter">⚡ <b>ShopTrust intercepted this Verdict loop</b> and rewrote its <code>compute_options</code> input: excluded ${inter.flaggedNames.map(esc).join(", ")}${inter.waitedMs > 0 ? ` (waited ${inter.waitedMs} ms for the audit)` : ""}.
        ${inter.changedRecommendation ? `<div class="was">Without ShopTrust: <s>${esc(inter.wouldHaveRecommended.title)} ${num(inter.wouldHaveRecommended.price)}</s> → now: <b>${esc(inter.nowRecommended.title)}</b> ${num(inter.nowRecommended.price)}</div>` : `<div class="was">Recommendation unchanged; flagged shops removed from the options.</div>`}
        <a href="#" class="src" data-ref="task:${v.taskId}">see the rewritten tool call</a></div>` : ""}
      <ol class="opts">${v.options.map((o) => optionRow(o, o.id === v.recommended, v.why)).join("")}</ol>
      ${v.notes?.length ? `<ul class="notes">${v.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
      <div class="expl"><p>${esc(v.explanation)}</p>
        <div class="expl-meta"><span class="tag ${v.explanationSource}">${v.explanationSource === "llm" ? "written by " + esc(v.model) : "template text (no LLM)"}</span>
        ${v.check !== "ok" ? `<span class="tag warn">${esc(v.check)}</span>` : `<span class="tag ok">number guard passed</span>`}
        <span>v${v.version}${it.verdictHistory.length ? ` · ${it.verdictHistory.length} earlier verdict(s) superseded` : ""}</span>
        <a href="#" class="src" data-ref="task:${v.taskId}">agent trace</a> · KP: ${it.kp.matches ? `${it.kp.matches.length} match(es) from ${it.kp.scanned.toLocaleString()} listings (${esc(it.kp.source)})` : "…"}</div></div>
      <p class="nfa">Not financial advice.</p>
    </article>`;
  }).join("");
}
function statusBadge(td) { const [cls, label] = STATUS[td?.status] || ["neutral", td?.status ?? "…"]; return `<span class="badge ${cls}">${esc(label)}</span>`; }
function optionRow(o, rec, why) {
  const delta = o.saving.v >= 0 ? `saves ${num(o.saving)} vs the ad` : `costs ${num({ ...o.saving, v: -o.saving.v })} more than the ad`;
  const conf = o.confidence;
  return `<li class="opt ${rec ? "rec" : ""}">
    <div class="opt-top"><b>${esc(o.title)}</b> ${num(o.price)} ${rec ? `<span class="badge good">best option</span>` : ""}${o.heuristic ? `<span class="badge neutral">heuristic</span>` : ""}</div>
    <div class="opt-meta">${delta}${o.vsBestNew ? ` · ${num(o.vsBestNew)} under best new price` : ""}${o.vsBuyNow ? ` · ${num(o.vsBuyNow, { signed: true })} vs buy now` : ""}${o.vsOwn30DayMin ? ` · vs its own 30-day min ${num(o.vsOwn30DayMin, { signed: true })}` : ""}</div>
    <div class="opt-meta"><span class="pill c-${conf.level}" title="${esc(conf.signals.map((s) => (s.ok ? "✓ " : "✗ ") + s.name).join("\n"))}">confidence: ${conf.level} (${conf.ok}/${conf.of} signals)</span>
      <span class="pill r-${o.risk.level}">risk: ${o.risk.level}</span> <span class="muted">${esc(o.risk.text)}</span></div>
    ${rec ? `<div class="why">${esc(why)}</div>` : ""}</li>`;
}

// ---------- trust ----------
function renderTrust() {
  const el = $("#trust");
  if (!run?.trust?.length) return;
  el.innerHTML = run.trust.sort((a, b) => (a.score ?? 101) - (b.score ?? 101)).map((t) => t.status !== "done" ? `<div class="trow"><b>${esc(t.name)}</b> <span class="muted">auditing…</span></div>` : `
    <div class="trow ${t.flagged ? "flagged" : ""}">
      <div class="trow-top"><b>${esc(t.name)}</b> ${t.flagged ? `<span class="badge bad">flagged</span>` : `<span class="badge good">ok</span>`}
        <a href="#" class="src" data-ref="audit:${t.retailerId}">${t.score}/100</a></div>
      <div class="meter"><i style="width:${t.score}%"></i></div>
      <div class="muted small">${t.violations}/${t.offersAudited} offers likely violate the 30-day rule · ${t.hikes} pre-BF hikes</div>
      <p class="small">${esc(t.rationale)} <span class="tag ${t.rationaleSource}">${t.rationaleSource === "llm" ? "LLM" : "template"}</span></p>
    </div>`).join("");
}

// ---------- log ----------
function appendLog(e) {
  const el = $("#log");
  const t = run ? (e.t - run.startedAt).toFixed(1) : "";
  const div = document.createElement("div");
  div.className = "lg lg-" + e.type.split(".")[0];
  div.innerHTML = `<span class="lt">${t}</span><span class="ly">${esc(e.type)}</span><span class="lp">${esc(e.producer)}</span><span class="ls">${esc(e.summary)}</span>`;
  el.appendChild(div);
  while (el.children.length > 400) el.firstChild.remove();
  el.scrollTop = el.scrollHeight;
}

// ---------- drawer / sources ----------
function openDrawer(title, html) { $("#drawer-title").textContent = title; $("#drawer-body").innerHTML = html; $("#drawer").classList.remove("hidden"); }
$("#drawer-close").onclick = () => $("#drawer").classList.add("hidden");

async function openSource(ref) {
  const s = await fetch(`/api/source?ref=${encodeURIComponent(ref)}&run=${run?.id ?? ""}`).then((r) => (r.ok ? r.json() : null));
  if (!s) return openDrawer(ref, `<p>Source not found.</p>`);
  openDrawer(s.title, renderSource(s, ref));
}
function renderSource(s, ref) {
  const file = s.file ? `<p class="muted">Dataset: <code>${esc(s.file)}</code> (synthetic)</p>` : "";
  if (s.kind === "offer" || s.kind === "kp") return file + kv(s.row) + (s.retailer ? `<p>${esc(s.retailer)} · ${esc(s.product)}</p>` : "");
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
function numberHtml(n) {
  return `<p class="bignum">${n.unit === "%" ? n.v + "%" : rsd(n.v)}</p><p><b>How:</b> ${esc(n.f)}</p><h4>Sources</h4><ul>${n.src.map((r) => `<li>${srcLink(r, describeRef(r))}</li>`).join("") || "<li>none</li>"}</ul>`;
}
function describeRef(r) {
  const [k, a, b, c] = r.split(":");
  const R = (id) => meta.retailers.find((x) => x.id === id)?.name ?? id, P = (id) => meta.products.find((x) => x.id === id)?.name ?? id;
  return k === "offer" ? `feed offer ${a}` : k === "hist" ? `price history ${P(b)} @ ${R(a)}${c ? " on " + c : ""}` : k === "kp" ? `KP listing ${a}` : k === "rule" ? "Zakon o trgovini čl. 37" : k === "audit" ? `ShopTrust audit of ${R(a)}` : k === "agent" ? `${a} agent output for ${P(b)}` : k === "calc" ? `${a === "fake" ? "fake-discount" : "plan saving"} for ${P(b)}` : r;
}
function kv(o) { return `<table class="tbl">${Object.entries(o).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(typeof v === "number" && k.toLowerCase().includes("price") ? rsd(v) : typeof v === "object" ? JSON.stringify(v) : v)}</td></tr>`).join("")}</table>`; }
function chart(s) {
  const W = 420, H = 140, pts = s.series, min = Math.min(...pts.map((p) => p.p)) * 0.97, max = Math.max(...pts.map((p) => p.p)) * 1.02;
  const x = (i) => (i / (pts.length - 1)) * W, y = (v) => H - ((v - min) / (max - min)) * H;
  const wi = pts.findIndex((p) => p.d >= s.windowFrom);
  const hi = pts.findIndex((p) => p.d === s.highlight);
  return `<svg viewBox="0 0 ${W} ${H + 18}" class="chart"><rect x="${x(Math.max(0, wi))}" y="0" width="${W - x(Math.max(0, wi))}" height="${H}" class="win"/><text x="${x(Math.max(0, wi)) + 4}" y="12" class="wt">30-day window</text>
    <polyline points="${pts.map((p, i) => `${x(i)},${y(p.p)}`).join(" ")}" class="line"/>${hi >= 0 ? `<circle cx="${x(hi)}" cy="${y(pts[hi].p)}" r="4" class="pt"/>` : ""}
    <text x="0" y="${H + 14}" class="wt">${pts[0].d}</text><text x="${W}" y="${H + 14}" text-anchor="end" class="wt">${pts.at(-1).d}</text></svg>`;
}

document.addEventListener("click", (e) => {
  const n = e.target.closest("[data-num]"); if (n) { e.preventDefault(); const obj = nums.get(n.dataset.num); if (obj) openDrawer("Where this number comes from", numberHtml(obj)); return; }
  const s = e.target.closest("[data-ref]"); if (s) { e.preventDefault(); openSource(s.dataset.ref); return; }
  const b = e.target.closest("[data-task]"); if (b) { openSource("task:" + b.dataset.task); }
});
$("#run").onclick = startRun;
$("#next").onclick = async () => { $("#next").disabled = true; await fetch(`/api/runs/${run.id}/next-page`, { method: "POST" }); };
boot();
