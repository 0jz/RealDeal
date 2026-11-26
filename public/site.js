// Public site: landing + embedded checker. Every figure comes from the server (/api/summary, /api/runs/*),
// i.e. from the same agents and rules as the "under the hood" view. Nothing here computes or hardcodes numbers.
import { $, esc, num, srcLink, nums, ctx, api, post, openDrawer, installSourceClicks, statusBadge, modePill, fmtInt } from "/js/common.js";

const AGENT_COPY = {
  PriceFeed: ["Reads the feed", "Loads the retailers’ Black Friday price lists page by page, including late price changes, and re-triggers checks when a price changes."],
  ThirtyDay: ["Applies the 30-day rule", "Compares each advertised “before” price with that retailer’s lowest price in the 30 days before the discount."],
  KP: ["Searches the marketplace", "Looks for sealed, same-model listings on a KupujemProdajem-style marketplace and rejects accessories and other variants."],
  CrossShop: ["Cross-shops", "Finds the same product (same GTIN) at the other retailers and checks their histories too."],
  ShopTrust: ["Audits retailers", "Scores each retailer on how often its discounts break the rule, and rewrites the Verdict agent’s tool call in flight to exclude flagged shops."],
  Verdict: ["Recommends", "Builds 2–3 options — buy now, buy sealed on KP, or wait — with savings, confidence and risk, and explains them."],
  PriceScout: ["Scans prices", "For barcode scans: the average price in Serbia, a synthetic world reference average, and the cheapest place to buy."],
};
let summary = null, meta = null, run = null, es = null, timer = null;
ctx.getRunId = () => run?.id ?? summary?.reference.runId;

async function boot() {
  meta = await api("/api/meta"); ctx.meta = meta;
  $("#mode").innerHTML = modePill(meta);
  $("#list").innerHTML = meta.lists.map((l) => `<option value="${l.id}">${esc(l.name)} (${l.count} items)</option>`).join("");
  const L = meta.law;
  $("#law").innerHTML = `<blockquote>${esc(L.translation)}</blockquote>
    <p>${srcLink(L.id, L.title)} ${L.urls.map((u, i) => `<a href="${u}" target="_blank" rel="noopener">[${i + 1}]</a>`).join(" ")}</p>
    <p class="muted small">${esc(L.context)}</p><p class="warn small"><b>Unverified:</b> ${esc(L.unverified)}</p>`;
  loadSummary();
}

async function loadSummary() {
  summary = await api("/api/summary");
  renderSummary();
  if (!summary.reference.complete) setTimeout(loadSummary, 300);
}

function renderSummary() {
  const s = summary, r = s.reference, h = r.headline, st = r.stats;
  $("#hood-link").href = `/demo.html?run=${r.runId}`;
  if (h?.complete) {
    const flagged = r.trust.filter((t) => t.flagged);
    $("#hero-stats").innerHTML = `
      <div class="hs"><div class="hs-v">${fmtInt(h.violations)}<span> of ${fmtInt(h.checked)}</span></div><div class="hs-l">advertised discounts in the demo feed are a likely violation of the 30-day rule</div></div>
      <div class="hs"><div class="hs-v red">${num(h.avoided, { plain: true })}</div><div class="hs-l">of fake “discount” the agents caught across ${fmtInt(h.total)} products</div></div>
      <div class="hs"><div class="hs-v green">${num(h.planSaves, { plain: true, signed: true })}</div><div class="hs-l">saved by following the agents’ best plan instead of the ads</div></div>
      <div class="hs"><div class="hs-v">${fmtInt(flagged.length)}<span> of ${fmtInt(r.trust.length)}</span></div><div class="hs-l">retailers flagged by ShopTrust (${flagged.map((t) => esc(t.name)).join(", ") || "none"})</div></div>`;
    $("#hero-foot").innerHTML = `Live result of ${fmtInt(st.agentsActive)} agents checking “${esc(r.listName)}” in this server session — ${fmtInt(st.tasks)} agent tasks in ${fmtInt(st.runMs)} ms. <a href="#" id="hero-breakdown">Breakdown</a> · <a href="/demo.html?run=${r.runId}">watch the timeline</a>`;
    $("#hero-breakdown").onclick = (e) => { e.preventDefault(); openBreakdown(h, r.runId); };
  }
  renderSpotlight(r.spotlight);
  $("#agent-grid").innerHTML = s.agents.map((a) => {
    const [title, text] = AGENT_COPY[a.name] || [a.name, ""];
    const n = st.byAgent[a.name] ?? 0;
    return `<div class="agent card"><div class="agent-top"><span class="dot" style="--c: var(--c-${esc(a.name)})"></span><b>${esc(a.name)}</b><span class="tag">${esc(title)}</span></div>
      <p>${esc(text)}</p><p class="muted small">${a.name === "PriceScout" ? "runs on scanner requests" : `${fmtInt(n)} task(s) in the reference run`} · ${(a.capabilities || []).map(esc).join(", ")}</p></div>`;
  }).join("");
  $("#run-stats").innerHTML = h?.complete ? [
    [st.peakConcurrency, "peak concurrent agent tasks"], [st.loops, "Mozaik agent loops"], [st.peakParallelWorkers, "worker threads busy at once"],
    [st.rewrites, "Verdict tool calls rewritten by ShopTrust"], [st.superseded, "stale results discarded after a price change"], [st.runMs, "ms end to end"],
  ].map(([v, l]) => `<div class="stat"><a href="#" class="num plain" data-ref="stats:${r.runId}">${fmtInt(v)}</a><span>${esc(l)}</span></div>`).join("") : "";
  const d = s.dataset;
  $("#dataset").innerHTML = `Synthetic dataset (${srcLink("dataset:", "details")}): ${fmtInt(d.retailers)} fictional retailers · ${fmtInt(d.products)} products · ${fmtInt(d.historyRows)} daily prices (${esc(d.historyFrom)} → ${esc(d.historyTo)}) · ${fmtInt(d.feedOffers)} Black Friday offers + ${fmtInt(d.lateUpdates)} late changes · ${fmtInt(d.kpListings)} marketplace listings · ${fmtInt(d.worldPriceRows)} world reference prices in ${fmtInt(d.worldMarkets)} markets. Seed ${esc(d.seed)}.`;
  $("#trust").innerHTML = r.trust.length ? r.trust.slice().sort((a, b) => a.score - b.score).map((t) => `
    <div class="tcard card ${t.flagged ? "flag" : ""}">${srcLink("audit:" + t.retailerId, t.name)}
      <div class="score"><b>${fmtInt(t.score)}</b>/100</div><div class="bar"><i style="width:${Math.max(0, Math.min(100, t.score))}%"></i></div>
      <p class="small">${fmtInt(t.violations)} of ${fmtInt(t.offersAudited)} discounted offers break the rule${t.flagged ? " · <b>flagged</b>" : ""}</p></div>`).join("") : `<div class="loading">Auditing retailers…</div>`;
}

function renderSpotlight(sp) {
  if (!sp) return;
  const td = sp.thirtyDay, rec = sp.recommended;
  $("#hero-claim").innerHTML = td.claimedPct ? `−${num(td.claimedPct, { plain: true })}` : "discount";
  $("#spotlight").innerHTML = `<p class="eyebrow">Worst ad in the demo feed</p>
    <h3>${esc(sp.product.name)} <span class="muted">at ${esc(sp.adRetailer)}</span></h3>${statusBadge(td)}
    <table class="spot-t">
      <tr><td>Advertised “before”</td><td>${num(td.advertisedBefore)}</td></tr>
      <tr><td>Black Friday price</td><td>${num(td.bfPrice)}</td></tr>
      <tr><td>Advertised discount</td><td>${num(td.claimedDiscount)} (${num(td.claimedPct)})</td></tr>
      <tr><td>Lowest price in the ${esc(td.windowDays)} days before</td><td>${num(td.min30)}</td></tr>
      <tr class="em"><td>Real discount</td><td>${num(td.realDiscount, { signed: true })} (${num(td.realPct)})</td></tr>
      <tr class="em red"><td>Fake part of the “saving”</td><td>${num(td.fakeDiscount)}</td></tr>
    </table>
    ${rec ? `<p class="rec">Agents recommend: <b>${esc(rec.title)}</b> for ${num(rec.price)}</p>` : ""}`;
}

function openBreakdown(h, runId) {
  openDrawer("Headline breakdown", `<p class="muted">${esc(h.avoided.f)}</p><p class="muted">${esc(h.planSaves.f)}</p>
    <table class="tbl"><tr><th>Product</th><th>Ad at</th><th>Fake part</th><th>Plan</th><th>Saving</th></tr>
    ${h.rows.map((r) => `<tr><td>${esc(r.product)}</td><td>${esc(r.adRetailer)}</td><td>${num(r.fake)}</td><td>${esc(r.planTitle ?? "—")}</td><td>${num(r.planSaving, { signed: true })}</td></tr>`).join("")}
    <tr class="sum"><td colspan="2">Total</td><td>${num(h.avoided)}</td><td></td><td>${num(h.planSaves, { signed: true })}</td></tr></table>
    <p><a href="/demo.html?run=${runId}">Open the run under the hood →</a></p>`);
}

// ---------- embedded checker (same API + SSE as the demo UI) ----------
async function startCheck() {
  $("#run").disabled = true;
  const { runId } = await post("/api/runs", { listId: $("#list").value });
  attach(runId);
}
function attach(runId) {
  es?.close(); run = { id: runId };
  $("#hood").href = `/demo.html?run=${runId}`; $("#hood").classList.remove("hidden");
  es = new EventSource(`/api/runs/${runId}/stream`);
  for (const ev of ["snapshot", "task", "headline", "items"]) es.addEventListener(ev, refresh);
}
function refresh() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    run = await api(`/api/runs/${run.id}`);
    renderRun();
    if (run.headline?.complete) { es?.close(); $("#run").disabled = false; }
  }, 80);
}
function renderRun() {
  const done = run.tasks.filter((t) => t.status !== "running").length;
  $("#progress-bar").style.width = run.tasks.length ? `${(100 * done) / run.tasks.length}%` : "0";
  const h = run.headline;
  $("#status").textContent = h?.complete ? `Done: ${run.stats.tasks} agent tasks, ${run.stats.runMs} ms` : `${run.tasks.filter((t) => t.status === "running").length} agent task(s) running…`;
  if (h) {
    $("#result-headline").classList.remove("hidden");
    $("#result-headline").innerHTML = `<div><span>You avoided</span> ${num(h.avoided, { cls: "red" })} <span>in fake discounts</span></div>
      <div><span>Best plan saves</span> ${num(h.planSaves, { cls: h.planSaves.v >= 0 ? "green" : "red", signed: true })} <span>vs. the ads</span></div>
      <p class="muted">${h.violations} of ${h.checked} ads are a likely violation of the 30-day rule${h.complete ? "" : " (in progress)"} · <a href="#" id="rh-break">breakdown</a></p>`;
    $("#rh-break").onclick = (e) => { e.preventDefault(); openBreakdown(h, run.id); };
  }
  $("#results").innerHTML = run.items.map((it) => {
    const v = it.verdict, td = it.thirtyDay, cur = v && v.version === it.version;
    const ret = meta.retailers.find((r) => r.id === it.adRetailerId)?.name;
    if (!cur) return `<article class="rcard pending card"><h3>${esc(it.product.name)}</h3><p class="muted">Ad at ${esc(ret)} · agents working…</p>${td ? statusBadge(td) : ""}</article>`;
    const rec = v.options.find((o) => o.id === v.recommended);
    return `<article class="rcard card">
      <div class="rc-head"><h3>${esc(it.product.name)}</h3>${statusBadge(td)}</div>
      <p class="muted small">Ad at ${esc(v.adRetailer)}: ${num(td.bfPrice)}${td.advertisedBefore ? `, “was” ${num(td.advertisedBefore)}` : ""}${td.min30 ? ` · 30-day low ${num(td.min30)}` : ""}${td.fakeDiscount?.v ? ` · fake part ${num(td.fakeDiscount, { cls: "red" })}` : ""}</p>
      <div class="opts">${v.options.map((o) => `<div class="opt ${o.id === v.recommended ? "best" : ""}">
        <div class="ot">${o.id === v.recommended ? "<b>Best:</b> " : ""}${esc(o.title)}</div>
        <div class="op">${num(o.price)}${o.saving ? ` <span class="sv ${o.saving.v < 0 ? "neg" : ""}">${o.saving.v >= 0 ? `saves ${num(o.saving)}` : `${num(o.saving, { signed: true })} vs the ad`}</span>` : ""}</div>
        <div class="small muted">confidence ${esc(o.confidence.level)} · risk ${esc(o.risk.level)}</div></div>`).join("")}</div>
      ${v.interception?.changedRecommendation ? `<p class="small warn">ShopTrust changed this recommendation (excluded ${esc(v.interception.flaggedNames.join(", "))}).</p>` : ""}
      <p class="small">${esc(v.explanation)}</p>
    </article>`;
  }).join("");
}

installSourceClicks();
$("#run").onclick = startCheck;
boot();
