// Mobile product scanner: camera (BarcodeDetector, or the vendored ZXing fallback), photo, or manual search.
// A scan starts a Mozaik run of kind "scan" (POST /api/scans); every figure shown comes from GET /api/scans/:id.
import { $, esc, rsd, num, srcLink, ctx, api, post, installSourceClicks, statusBadge, fmtInt } from "./js/common.js";

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
let stream = null, stopLoop = null, scanId = null, pollTimer = null, meta = null;
ctx.getRunId = () => scanId;

async function boot() {
  meta = await api("/api/meta"); ctx.meta = meta;
  $("#mode").innerHTML = meta.mode === "llm" ? `<span class="mode llm">LLM · ${esc(meta.model)}</span>` : `<span class="mode tpl" title="${esc(meta.reason)}">No-key mode</span>`;
  $("#products").innerHTML = meta.products.map((p) => `<option value="${esc(p.name)}">${esc(p.ean13 ?? "")}</option>`).join("");
  if (!window.isSecureContext) $("#cam-help").innerHTML = "Live camera needs <b>https://</b> or localhost. Use <b>Photo</b> or type the code instead.";
  const code = new URLSearchParams(location.search).get("code") || new URLSearchParams(location.search).get("q");
  if (code) { $("#q").value = code; scan(code); }
}

// ---------- camera ----------
function loadZxing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  return new Promise((ok, fail) => { const s = document.createElement("script"); s.src = "vendor/zxing.min.js"; s.onload = () => ok(window.ZXing); s.onerror = fail; document.head.append(s); });
}
async function nativeDetector() {
  if (!("BarcodeDetector" in window)) return null;
  try { const f = await BarcodeDetector.getSupportedFormats(); const use = FORMATS.filter((x) => f.includes(x)); return use.length ? new BarcodeDetector({ formats: use }) : null; } catch { return null; }
}
function zxingHints(Z) { const h = new Map(); h.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E]); h.set(Z.DecodeHintType.TRY_HARDER, true); return h; }

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) { $("#cam-help").innerHTML = "Camera unavailable here (needs https:// or localhost and camera permission). Use <b>Photo</b> or type the code."; return; }
  stopCamera();
  $("#viewport").classList.remove("hidden");
  const video = $("#video");
  try {
    const det = await nativeDetector();
    if (det) {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      video.srcObject = stream; await video.play();
      $("#cam-help").textContent = "Point at the barcode (native BarcodeDetector).";
      let live = true; stopLoop = () => (live = false);
      const tick = async () => {
        if (!live) return;
        try { const codes = await det.detect(video); if (codes.length) { stopCamera(); return found(codes[0].rawValue); } } catch {}
        setTimeout(tick, 120);
      };
      tick();
    } else {
      const Z = await loadZxing();
      const reader = new Z.BrowserMultiFormatReader(zxingHints(Z));
      $("#cam-help").textContent = "Point at the barcode (ZXing decoder).";
      stopLoop = () => reader.reset();
      await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } } }, video, (res) => { if (res) { stopCamera(); found(res.getText()); } });
    }
  } catch (e) { stopCamera(); $("#cam-help").textContent = `Camera error: ${e.message || e}. Use Photo or type the code.`; }
}
function stopCamera() {
  stopLoop?.(); stopLoop = null;
  stream?.getTracks().forEach((t) => t.stop()); stream = null;
  const v = $("#video"); v.srcObject?.getTracks?.().forEach((t) => t.stop()); v.srcObject = null;
  $("#viewport").classList.add("hidden");
}
async function fromPhoto(file) {
  if (!file) return;
  $("#cam-help").textContent = "Reading the photo…";
  try {
    const det = await nativeDetector();
    if (det) { const codes = await det.detect(await createImageBitmap(file)); if (codes.length) return found(codes[0].rawValue); }
    const Z = await loadZxing(); const url = URL.createObjectURL(file);
    try { const res = await new Z.BrowserMultiFormatReader(zxingHints(Z)).decodeFromImageUrl(url); return found(res.getText()); } finally { URL.revokeObjectURL(url); }
  } catch { $("#cam-help").textContent = "No barcode found in that photo. Try again closer, or type the code."; }
}
function found(code) { navigator.vibrate?.(60); $("#q").value = code; $("#cam-help").textContent = `Scanned ${code}`; scan(code); }

// ---------- scan run ----------
async function scan(code) {
  clearTimeout(pollTimer);
  const el = $("#result"); el.classList.remove("hidden");
  el.innerHTML = `<div class="card"><div class="skeleton"></div></div>`;
  try {
    const r = await post("/api/scans", { code });
    scanId = r.runId;
    history.replaceState(null, "", `?code=${encodeURIComponent(r.product.ean13 || code)}`);
    poll();
  } catch (e) { el.innerHTML = `<div class="card alert">${esc(e.status === 404 ? `“${code}” is not in the synthetic demo catalogue. Try a code from the demo barcode sheet.` : e.message)}</div>`; }
}
async function poll() {
  const id = scanId;
  const r = await api(`/api/scans/${id}`);
  if (id !== scanId) return;
  render(r);
  if (!r.complete) pollTimer = setTimeout(poll, 200);
}

// Wording only: the figure itself is the server's sourced number (average − price).
const vs = (n, label) => !n ? "" : n.v > 0 ? `<span class="save">${num(n, { plain: true })} below</span> ${label}` : n.v === 0 ? `${num(n, { plain: true })} difference: same as ${label}` : `${num(n, { signed: true, plain: true })} vs ${label}`;
const AGENT_ORDER = ["PriceFeed", "ThirtyDay", "KP", "CrossShop", "ShopTrust", "PriceScout", "Verdict"];
function render(r) {
  const p = r.product, sr = r.serbia, w = r.world, best = r.best, ch = r.cheapestOverall;
  const status = (a) => { const ts = r.tasks.filter((t) => t.agent === a); return !ts.length ? "wait" : ts.some((t) => t.status === "running") ? "running" : "done"; };
  const chips = AGENT_ORDER.map((a) => `<span class="chip ${status(a)}" style="--c: var(--c-${a})"><i></i>${a}</span>`).join("");
  const pending = `<div class="skeleton"></div>`;
  const svw = r.serbiaVsWorld;
  $("#result").innerHTML = `
    <div class="card prod"><h2>${esc(p.name)}</h2><span class="ean">EAN ${esc(p.ean13)} · ${esc(p.category)}</span><div class="chips">${chips}</div></div>
    <div class="tiles">
      <div class="tile"><div class="k">Average price in Serbia</div><div class="v">${sr ? num(sr.avgNow, { plain: true }) : pending}</div><div class="s">${sr ? `${fmtInt(sr.shops)} shops today · 30-day avg ${num(sr.avg30, { plain: true })}` : "PriceScout…"}</div></div>
      <div class="tile"><div class="k">World average (synthetic ref.)</div><div class="v">${w ? num(w.avg, { plain: true }) : sr ? "—" : pending}</div><div class="s">${w ? `${fmtInt(w.markets)} markets · Serbia vs world ${num(svw, { signed: true, plain: true })}` : sr ? "no reference prices" : "PriceScout…"}</div></div>
      <div class="tile best"><div class="k">Best place to buy (agents’ recommendation)</div>
        ${best ? `<div class="where">${esc(best.title)}</div><div class="v">${num(best.price, { plain: true })}</div>
          <div class="s">${vs(r.savings.bestVsSerbiaAvg, "the Serbian average")}${r.savings.bestVsWorldAvg ? ` · ${vs(r.savings.bestVsWorldAvg, "the world average")}` : ""}</div>
          <div class="s">confidence ${esc(best.confidence.level)} · risk ${esc(best.risk.level)}</div>
          <div class="s">${esc(best.why)}</div>` : `${pending}<div class="s">Verdict is waiting for ShopTrust, KP and CrossShop…</div>`}
      </div>
    </div>
    ${ch?.flagged ? `<div class="alert">The lowest sticker price is at <b>${esc(ch.retailer)}</b> (${num(ch.price)}), but ShopTrust flagged that shop for fake discounts, so the agents recommend another offer.</div>` : ""}
    ${r.thirtyDay ? `<div class="card"><h3>The advertised deal at ${esc(r.adRetailer)}</h3>${statusBadge(r.thirtyDay)}
      <table class="mini"><tr><td>Black Friday price</td><td>${num(r.thirtyDay.bfPrice)}</td></tr>${r.thirtyDay.advertisedBefore ? `<tr><td>“Was”</td><td>${num(r.thirtyDay.advertisedBefore)}</td></tr>` : ""}${r.thirtyDay.min30 ? `<tr><td>Lowest in the previous ${esc(r.thirtyDay.windowDays)} days</td><td>${num(r.thirtyDay.min30)}</td></tr>` : ""}${r.thirtyDay.fakeDiscount?.v ? `<tr><td>Fake part of the discount</td><td>${num(r.thirtyDay.fakeDiscount, { cls: "red" })}</td></tr>` : ""}</table></div>` : ""}
    ${r.options.length ? `<div class="card"><h3>All options</h3><table class="mini">${r.options.map((o) => `<tr class="${o.title === best?.title ? "low" : ""}"><td>${esc(o.title)}<div class="small muted">confidence ${esc(o.confidence.level)} · risk ${esc(o.risk.level)}</div></td><td>${num(o.price)}</td></tr>`).join("")}</table>${r.explanation ? `<p class="small">${esc(r.explanation)}</p>` : ""}</div>` : ""}
    ${sr ? `<div class="card"><h3>Serbian shops (fictional)</h3><table class="mini">${sr.rows.slice().sort((a, b) => a.price - b.price).map((x) => `<tr class="${x.offerId === ch?.offerId ? "low" : ""}"><td>${esc(meta.retailers.find((m) => m.id === x.retailerId)?.name)}${x.offerId === ch?.offerId && ch.flagged ? ' <span class="badge bad">flagged</span>' : ""}</td><td>${srcLink("offer:" + x.offerId, rsd(x.price))}</td></tr>`).join("")}</table></div>` : ""}
    ${w ? `<div class="card"><h3>World reference prices <span class="badge warn">synthetic</span></h3><table class="mini"><tr><th>Market</th><th>Local</th><th>In RSD</th></tr>${w.rows.map((x) => `<tr><td>${esc(x.country)}</td><td>${srcLink("world:" + x.id, `${x.price.toLocaleString("en-US")} ${x.currency}`)}</td><td>${num(x.rsd)}</td></tr>`).join("")}</table>
      <p class="small muted">Converted with approximate fixed rates (${[...new Set(w.rows.map((x) => x.currency))].map((c) => srcLink("fx:" + c, c)).join(", ")}), not live or official rates. Generated reference data, not real market prices.</p></div>` : ""}
    ${r.scoutSummary ? `<p class="small muted">PriceScout (${esc(r.scoutSummarySource)}): ${esc(r.scoutSummary)}</p>` : ""}
    <p class="small"><a href="demo.html?run=${r.runId}">See the agents work on this scan →</a></p>
    <p class="small muted">Synthetic data · fictional retailers · Not financial advice.</p>`;
}

installSourceClicks();
$("#camera").onclick = startCamera;
$("#stop").onclick = stopCamera;
$("#photo").onchange = (e) => fromPhoto(e.target.files[0]);
$("#manual").onsubmit = (e) => { e.preventDefault(); const q = $("#q").value.trim(); if (q) scan(q); };
boot();
