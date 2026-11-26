// Single-file frontend: no build step. Talks to the Node server over REST + Server-Sent Events.
import { $, esc, rsd, num, srcLink, nums, ctx, openDrawer, openSource, installSourceClicks, statusBadge, STATUS } from "/js/common.js";
const AGENTS = ["PriceFeed", "ThirtyDay", "KP", "CrossShop", "ShopTrust", "Verdict", "PriceScout"];
const AGENT_INFO = {
  PriceFeed: "reads the synthetic feed (async file I/O)", ThirtyDay: "30-day rule, sync arithmetic", KP: "LLM loop + worker search",
  CrossShop: "worker: same GTIN across shops", ShopTrust: "LLM loop + worker audit; intercepts Verdict", Verdict: "LLM loop: options + explanation",
  PriceScout: "scanner runs: LLM loop + worker averages",
};

let meta = null, run = null, es = null, refetchTimer = null, renderQueued = false;
ctx.getRunId = () => run?.id;

// ---------- boot ----------
async function boot() {
  meta = await fetch("/api/meta").then((r) => r.json()); ctx.meta = meta;
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
// Time axis with idle gaps (e.g. waiting for a button click) compressed, so every burst of agent work stays readable.
function buildScale(tasks, t0, nowAbs) {
  const iv = tasks.map((t) => [t.start - t0, (t.end ?? nowAbs) - t0]).sort((a, b) => a[0] - b[0]);
  const busy = [];
  for (const [a, b] of iv) { const last = busy.at(-1); if (last && a <= last[1] + 80) last[1] = Math.max(last[1], b); else busy.push([a, b]); }
  if (!busy.length) busy.push([0, 10]);
  busy[0][0] = 0;
  const GAP = 4; // % of width per compressed gap
  const total = busy.reduce((s, [a, b]) => s + (b - a), 0) * 1.03 || 1;
  const avail = 100 - GAP * (busy.length - 1);
  const segs = []; let x = 0;
  busy.forEach(([a, b], i) => { const w = ((b - a) / total) * avail; segs.push({ a, b, x, w }); x += w + (i < busy.length - 1 ? GAP : 0); });
  const map = (rel) => {
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (rel <= s.b || i === segs.length - 1) return rel < s.a ? s.x : s.x + ((rel - s.a) / Math.max(0.001, s.b - s.a)) * s.w;
      if (rel < segs[i + 1].a) return s.x + s.w + GAP / 2;
    }
    return 100;
  };
  return { map, segs };
}

function renderTimeline() {
  if (!run) return;
  const el = $("#timeline");
  const t0 = run.startedAt;
  const nowAbs = performance.timeOrigin + performance.now();
  const { map, segs } = buildScale(run.tasks, t0, nowAbs);
  const pctX = (abs) => map(abs - t0);
  const lanes = AGENTS.filter((a) => a !== "PriceScout" || run.tasks.some((t) => t.agent === a)).map((agent) => {
    const tasks = run.tasks.filter((t) => t.agent === agent).sort((a, b) => a.start - b.start);
    const rows = [];
    for (const t of tasks) {
      const l = pctX(t.start), r = Math.max(pctX(t.end ?? nowAbs), l + 0.3);
      let row = rows.findIndex((rowEnd) => rowEnd <= l - 0.1);
      if (row < 0) { rows.push(r); row = rows.length - 1; } else rows[row] = r;
      t._row = row;
    }
    const height = Math.max(1, rows.length);
    const bars = tasks.map((t) => {
      const endAbs = t.end ?? nowAbs;
      const left = pctX(t.start), width = Math.max(0.3, pctX(endAbs) - left);
      const span = Math.max(0.001, endAbs - t.start);
      const segsHtml = (t.steps || []).map((s) => {
        const sl = ((s.start - t.start) / span) * 100;
        const sw = (((s.end ?? endAbs) - s.start) / span) * 100;
        return `<i class="seg seg-${s.kind}" style="left:${sl}%;width:${Math.max(0.5, sw)}%" title="${esc(s.label)}: ${((s.end ?? endAbs) - s.start).toFixed(1)} ms"></i>`;
      }).join("");
      const dur = (endAbs - t.start).toFixed(1);
      const cls = [`bar`, `k-${t.kind}`, `s-${t.status}`, t.stale ? "stale" : "", t.interception?.changed ? "intercepted" : ""].join(" ");
      return `<div class="${cls}" data-task="${t.id}" style="left:${left}%;width:${width}%;top:${t._row * 22}px" title="${esc(t.label)} · ${dur} ms · ${esc(t.status)}${t.note ? " · " + esc(t.note) : ""}">${segsHtml}<span>${esc(t.label)}${t.status === "superseded" ? " (superseded)" : ""}${t.interception?.changed ? " ⚡" : ""}</span></div>`;
    }).join("");
    const breaks = segs.slice(1).map((s) => `<i class="gap" style="left:${s.x - 4}%;width:4%"></i>`).join("");
    return `<div class="lane"><div class="lane-name"><b>${agent}</b><small>${AGENT_INFO[agent]}</small></div><div class="lane-track" style="height:${height * 22 + 4}px">${breaks}${bars}</div></div>`;
  }).join("");
  const ticks = [];
  segs.forEach((s, i) => {
    const len = s.b - s.a, step = niceStep(len / Math.max(1, Math.round(s.w / 14)));
    for (let v = Math.ceil(s.a / step) * step; v <= s.b; v += step) ticks.push(`<span style="left:${map(v)}%">${fmtMs(v)}</span>`);
    if (i > 0) ticks.push(`<span class="gapl" style="left:${s.x - 2}%">idle ${fmtMs(s.a - segs[i - 1].b)}</span>`);
  });
  el.innerHTML = `${lanes}<div class="axis"><div class="lane-name"></div><div class="ticks">${ticks.join("")}</div></div>`;
  const asyncTasks = run.tasks.filter((t) => t.kind !== "sync");
  const ev = asyncTasks.flatMap((t) => [[t.start, 1], [t.end ?? Infinity, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let c = 0, peak = 0; for (const [, d] of ev) { c += d; peak = Math.max(peak, c); }
  const sup = run.tasks.filter((t) => t.status === "superseded").length;
  const inter = run.tasks.filter((t) => t.interception?.changed).length;
  $("#tl-stats").innerHTML = `<span>peak concurrency <b>${peak}</b> async tasks</span><span><b>${run.tasks.length}</b> tasks</span><span><b>${sup}</b> superseded</span><span><b>${inter}</b> Verdict loops rewritten by ShopTrust</span>`;
}
const fmtMs = (v) => (v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(2)} s`);
function niceStep(x) { const p = 10 ** Math.floor(Math.log10(x)); return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= x); }

// ---------- product cards ----------
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

installSourceClicks((e) => { const b = e.target.closest("[data-task]"); if (b) openSource("task:" + b.dataset.task); });
$("#run").onclick = startRun;
$("#next").onclick = async () => { $("#next").disabled = true; await fetch(`/api/runs/${run.id}/next-page`, { method: "POST" }); };
boot();
