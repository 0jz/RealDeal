// Pure, deterministic rules. Every number they produce carries `src` (where it came from)
// and `f` (how it was computed). Used by agents on the main thread and inside worker threads.

export const LAW = {
  id: "rule:art37",
  title: "Zakon o trgovini, čl. 37 (Sl. glasnik RS 52/2019 i 35/2026)",
  quote: "Prethodna cena je najniža cena po kojoj je trgovac nudio robu tokom perioda od 30 dana pre početka sniženja cena … Prethodna cena za proizvode koji se nalaze u asortimanu trgovca kraće od 30 dana je najniža cena … u periodu ne kraćem od 15 dana do početka sniženja cena.",
  translation: "The 'previous price' is the lowest price at which the trader offered the goods during the 30 days before the start of the price reduction. For goods in the assortment for less than 30 days: the lowest price over a period of at least 15 days before the reduction.",
  urls: [
    "https://www.paragraf.rs/propisi/zakon_o_trgovini.html",
    "https://www.parlament.gov.rs/upload/archive/files/lat/pdf/zakoni/14_saziv/1266-26-lat..pdf",
  ],
  context: "Published in Sl. glasnik RS 35/2026 together with the new Zakon o zaštiti potrošača (whose čl. 6 requires machine-readable, real-time price lists).",
  unverified: "Application date 1 May 2026 is taken from a law-firm summary (vraneseviclaw.com, 01.09.2026), not checked against the Official Gazette text.",
};

export const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const dayDiff = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);
export const fmtRSD = (v) => Math.round(v).toLocaleString("en-US") + " RSD";
const pct = (a, b) => (b === 0 ? 0 : Math.round(((b - a) / b) * 1000) / 10);

/** A sourced number. */
export const N = (v, src, f, unit = "RSD") => ({ v, unit, src: [].concat(src).filter(Boolean), f });
export const histRef = (rid, pid, date) => (date ? `hist:${rid}:${pid}:${date}` : `hist:${rid}:${pid}`);
export const offerRef = (offerId) => `offer:${offerId}`;

/** ThirtyDay rule (Zakon o trgovini čl. 37 st. 3-4). */
export function thirtyDayCheck(series, offer, bfDate) {
  const rid = offer.retailerId, pid = offer.productId;
  const prior = series.filter((r) => r.d < bfDate);
  const inAssortmentDays = prior.length ? dayDiff(prior[0].d, bfDate) : 0;
  let rule, window;
  if (inAssortmentDays >= 30) {
    rule = "30-day"; window = prior.filter((r) => r.d >= addDays(bfDate, -30));
  } else {
    rule = "15-day (in assortment < 30 days)"; window = prior;
  }
  if (!window.length || (rule !== "30-day" && inAssortmentDays < 15)) {
    return { status: "insufficient-history", rule, windowDays: window.length, sources: [histRef(rid, pid)] };
  }
  const minRow = window.reduce((m, r) => (r.p < m.p ? r : m), window[0]);
  const bf = offer.bfPrice, min = minRow.p;
  const oref = offerRef(offer.id), mref = histRef(rid, pid, minRow.d);
  if (offer.advertisedBefore == null) {
    return {
      status: "no-discount-claimed", rule, windowFrom: window[0].d, windowTo: window[window.length - 1].d, windowDays: window.length, inAssortmentDays,
      advertisedBefore: null, bfPrice: N(bf, oref, "current price in the feed (no discount advertised)"),
      min30: N(min, [mref, histRef(rid, pid), LAW.id], `lowest price ${window[0].d}…${window[window.length - 1].d}, seen on ${minRow.d}`), minDate: minRow.d,
      claimedDiscount: N(0, oref, "no discount advertised"), claimedPct: N(0, oref, "no discount advertised", "%"),
      realDiscount: N(min - bf, [mref, oref], "30-day minimum − current price"), realPct: N(pct(bf, min), [mref, oref], "(min30 − price) / min30", "%"),
      fakeDiscount: N(0, oref, "no discount advertised, so nothing fake"), sources: [oref, mref],
    };
  }
  const before = offer.advertisedBefore;
  const status = before > min ? "likely-violation" : bf < min ? "real-discount" : "no-real-discount";
  return {
    status, rule, windowFrom: window[0].d, windowTo: window[window.length - 1].d, windowDays: window.length, inAssortmentDays,
    advertisedBefore: N(before, oref, "advertised 'before' price in the offer"),
    bfPrice: N(bf, oref, "Black Friday price in the offer"),
    min30: N(min, [mref, histRef(rid, pid), LAW.id], `lowest price ${window[0].d}…${window[window.length - 1].d} (${rule} rule), seen on ${minRow.d}`),
    minDate: minRow.d,
    claimedDiscount: N(before - bf, oref, "advertised before − BF price"),
    claimedPct: N(pct(bf, before), oref, "(before − BF) / before", "%"),
    realDiscount: N(min - bf, [mref, oref], "30-day minimum − BF price"),
    realPct: N(pct(bf, min), [mref, oref], "(min30 − BF) / min30", "%"),
    fakeDiscount: N(Math.max(0, before - Math.max(min, bf)), [oref, mref], "before − max(min30, BF price): the part of the advertised saving that is not real"),
    sources: [oref, mref, LAW.id],
  };
}

/** Promo dips in a series: runs of days at least 8% under the series median. */
export function findDips(series) {
  if (series.length < 10) return [];
  const sorted = [...series.map((r) => r.p)].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const dips = [];
  let cur = null;
  for (const r of series) {
    if (r.p <= median * 0.92) {
      if (!cur) cur = { from: r.d, to: r.d, low: r.p, lowDate: r.d };
      cur.to = r.d;
      if (r.p < cur.low) { cur.low = r.p; cur.lowDate = r.d; }
    } else if (cur) { dips.push(cur); cur = null; }
  }
  if (cur) dips.push(cur);
  return dips.map((d) => ({ ...d, median }));
}

/** CrossShop: same product (same GTIN) across all retailers with a current offer. */
export function crossShopCompare(history, productId, offers, bfDate) {
  const rows = offers.map((o) => {
    const series = history[`${o.retailerId}:${productId}`] || [];
    const check = thirtyDayCheck(series, o, bfDate);
    const dips = findDips(series);
    return { retailerId: o.retailerId, offerId: o.id, bfPrice: o.bfPrice, advertisedBefore: o.advertisedBefore, status: check.status, min30: check.min30?.v ?? null, minDate: check.minDate ?? null, realDiscount: check.realDiscount?.v ?? null, dips, historyDays: series.length };
  }).sort((a, b) => a.bfPrice - b.bfPrice);
  const cheapest = rows[0];
  return { productId, rows, cheapestRetailerId: cheapest?.retailerId ?? null, spread: rows.length > 1 ? rows[rows.length - 1].bfPrice - rows[0].bfPrice : 0 };
}

/** ShopTrust audit: how a retailer's "before" prices compare with its own 30-day minimums. */
export function trustAudit(history, retailerId, offersPage1, bfDate) {
  const offers = offersPage1.filter((o) => o.retailerId === retailerId && o.advertisedBefore != null); // audit discount claims only
  const checks = offers.map((o) => ({ offerId: o.id, productId: o.productId, ...pickCheck(thirtyDayCheck(history[`${retailerId}:${o.productId}`] || [], o, bfDate)) }));
  const violations = checks.filter((c) => c.status === "likely-violation");
  // price hikes: >= 15% increase within the 21 days before BF vs the price 30 days before BF
  const hikes = offers.filter((o) => {
    const s = history[`${retailerId}:${o.productId}`] || [];
    const ref = s.find((r) => r.d === addDays(bfDate, -30));
    return ref && s.some((r) => r.d >= addDays(bfDate, -21) && r.p >= ref.p * 1.15);
  });
  const n = offers.length || 1;
  const violationRate = violations.length / n;
  const hikeRate = hikes.length / n;
  const score = Math.max(0, Math.round(100 - 60 * violationRate - 30 * hikeRate));
  const flagged = score < 60;
  return {
    retailerId, offersAudited: offers.length, violations: violations.length, hikes: hikes.length, score, flagged,
    formula: "score = 100 − 60 × (likely-violation offers / audited offers) − 30 × (offers with a ≥15% hike in the 21 days before BF / audited offers); flagged if score < 60",
    violationOffers: violations.map((v) => v.offerId), hikeOffers: hikes.map((o) => o.id), checks,
    sources: offers.map((o) => offerRef(o.id)),
  };
}
const pickCheck = (c) => ({ status: c.status, min30: c.min30?.v ?? null, before: c.advertisedBefore?.v ?? null, bf: c.bfPrice?.v ?? null });

/** Confidence from the number of corroborating signals. */
function confidenceFrom(signals) {
  const ok = signals.filter((s) => s.ok).length;
  const level = ok >= 4 ? "high" : ok >= 3 ? "medium" : "low";
  return { level, ok, of: signals.length, signals };
}

/**
 * Verdict options (2-3 actionable choices). `ctx` holds the inputs produced by the other agents.
 * args.excludeRetailers / args.trust are what ShopTrust's interception rewrites in flight.
 */
export function buildOptions(ctx, args = {}) {
  const { product, adOffer, thirty, cross, kp, retailerName, trust = {} } = ctx;
  const exclude = new Set(args.excludeRetailers || []);
  const trustArg = { ...trust, ...(args.trust || {}) };
  const options = [];
  const notes = [];
  const adPrice = adOffer.bfPrice;
  const adRef = offerRef(adOffer.id);

  // 1) Buy now at the best retailer that is not excluded
  const candidates = cross.rows.filter((r) => !exclude.has(r.retailerId));
  const excludedCheaper = cross.rows.filter((r) => exclude.has(r.retailerId) && candidates[0] && r.bfPrice < candidates[0].bfPrice);
  for (const r of excludedCheaper) notes.push(`${retailerName(r.retailerId)} has a lower price (${fmtRSD(r.bfPrice)}) but was excluded: ShopTrust flagged it (trust ${trustArg[r.retailerId]?.score ?? "?"}/100).`);
  const best = candidates[0];
  if (best) {
    const t = trustArg[best.retailerId];
    const signals = [
      { name: "30-day history available", ok: best.min30 !== null, src: histRef(best.retailerId, product.id) },
      { name: "Compared across retailers", ok: cross.rows.length >= 2, src: `agent:CrossShop:${product.id}` },
      { name: "Retailer trust audited and not flagged", ok: !!t && !t.flagged, src: `audit:${best.retailerId}` },
      { name: "Price at or below its own 30-day minimum", ok: best.min30 !== null && best.bfPrice <= best.min30, src: histRef(best.retailerId, product.id, best.minDate) },
    ];
    options.push({
      id: "buy-now", kind: "buy-now", title: `Buy now at ${retailerName(best.retailerId)}`,
      retailerId: best.retailerId,
      price: N(best.bfPrice, offerRef(best.offerId), "current BF offer"),
      saving: N(adPrice - best.bfPrice, [adRef, offerRef(best.offerId)], "advertised offer you saw − this offer"),
      vsOwn30DayMin: best.min30 !== null ? N(best.min30 - best.bfPrice, [histRef(best.retailerId, product.id, best.minDate), offerRef(best.offerId)], "retailer's own 30-day minimum − BF price (real discount)") : null,
      confidence: confidenceFrom(signals),
      risk: { level: t?.flagged ? "high" : t && t.score < 75 ? "medium" : "low", text: t?.flagged ? "Retailer flagged by ShopTrust" : "New item from a retailer, statutory warranty applies" },
    });
  }

  // 2) Buy on KP (sealed) — only sealed listings, only if cheaper than the best new price, with a price-sanity check
  if (kp && kp.matches?.length) {
    const bestNew = best ? best.bfPrice : adPrice;
    const sealed = kp.matches.filter((m) => m.condition === "sealed").sort((a, b) => a.price - b.price);
    const sane = sealed.filter((m) => m.price >= bestNew * 0.4);
    for (const m of sealed.filter((m) => m.price < bestNew * 0.4)) notes.push(`KP listing ${m.id} ignored by the price-sanity check (${fmtRSD(m.price)} is under 40% of the best new price — likely not the same item).`);
    const l = sane[0];
    if (l && l.price < bestNew) {
      const signals = [
        { name: "KP agent matched the exact model", ok: true, src: `kp:${l.id}` },
        { name: "Listing is sealed", ok: true, src: `kp:${l.id}` },
        { name: "Seller rating ≥ 95%", ok: l.sellerRating >= 95, src: `kp:${l.id}` },
        { name: "Matched by LLM (not template rules)", ok: kp.source === "llm", src: `agent:KP:${product.id}` },
      ];
      options.push({
        id: "buy-kp", kind: "buy-kp", title: `Buy on KP (sealed) — ${l.city}`, listingId: l.id,
        price: N(l.price, `kp:${l.id}`, "KP listing price (synthetic listing)"),
        saving: N(adPrice - l.price, [adRef, `kp:${l.id}`], "advertised offer you saw − KP price"),
        vsBestNew: N(bestNew - l.price, [best ? offerRef(best.offerId) : adRef, `kp:${l.id}`], "best new price − KP price"),
        confidence: confidenceFrom(signals),
        risk: { level: "medium", text: "Private seller: no retailer warranty or 14-day return; check the seal and the original receipt" },
      });
    }
  }

  // 3) Wait N days — heuristic from recurring promo dips in the synthetic 60-day history
  const dipRows = cross.rows.filter((r) => !exclude.has(r.retailerId) && r.dips.length >= 2);
  if (best && dipRows.length) {
    const r = dipRows.sort((a, b) => Math.min(...a.dips.map((d) => d.low)) - Math.min(...b.dips.map((d) => d.low)))[0];
    const starts = r.dips.map((d) => d.from);
    const gaps = starts.slice(1).map((s, i) => dayDiff(starts[i], s));
    const cycle = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    const lastStart = starts[starts.length - 1];
    const bfDate = adOffer.publishedAt.slice(0, 10);
    let next = addDays(lastStart, cycle);
    while (next <= bfDate) next = addDays(next, cycle);
    const waitDays = dayDiff(bfDate, next);
    const low = Math.max(...r.dips.map((d) => d.low)); // conservative: the highest of the dip lows
    if (low < best.bfPrice) {
      options.push({
        id: "wait", kind: "wait", title: `Wait ~${waitDays} days (${retailerName(r.retailerId)} promo cycle)`, retailerId: r.retailerId, waitDays,
        price: N(low, r.dips.map((d) => histRef(r.retailerId, product.id, d.lowDate)), `highest of the past dip lows (dips every ~${cycle} days in the synthetic history)`),
        saving: N(adPrice - low, [adRef, histRef(r.retailerId, product.id)], "advertised offer you saw − expected dip price"),
        vsBuyNow: N(best.bfPrice - low, [offerRef(best.offerId), histRef(r.retailerId, product.id)], "best buy-now price − expected dip price"),
        confidence: { level: "low", ok: r.dips.length, of: r.dips.length, signals: [{ name: `${r.dips.length} past dips, median cycle ${cycle} days (heuristic, not a forecast)`, ok: true, src: histRef(r.retailerId, product.id) }] },
        risk: { level: "medium", text: "Heuristic only: the dip may not repeat and the item may sell out" },
        heuristic: true,
      });
    }
  }

  // Recommendation (rules, transparent)
  let recommended = options.find((o) => o.kind === "buy-now")?.id ?? options[0]?.id;
  const bn = options.find((o) => o.kind === "buy-now");
  const kpO = options.find((o) => o.kind === "buy-kp");
  const wait = options.find((o) => o.kind === "wait");
  let why = "Cheapest new offer from a retailer that is not flagged.";
  if (kpO && bn && kpO.vsBestNew.v >= bn.price.v * 0.15 && kpO.confidence.level !== "low") { recommended = kpO.id; why = "Sealed KP listing is at least 15% under the best new price."; }
  else if (wait && bn && bn.vsOwn30DayMin && bn.vsOwn30DayMin.v <= 0 && wait.vsBuyNow.v >= bn.price.v * 0.05) { recommended = wait.id; why = "No real discount right now (price is not under its own 30-day minimum) and past dips were at least 5% lower."; }
  return { options, recommended, why, notes, args: { excludeRetailers: [...exclude], trust: trustArg } };
}

/** All numbers a model may legitimately mention when explaining this verdict. */
export function collectNumbers(obj, out = new Set()) {
  if (obj == null) return out;
  if (typeof obj === "number") { out.add(Math.round(obj * 10) / 10); return out; }
  if (typeof obj === "string") { for (const m of obj.matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.add(Number(m[0].replace(/,/g, ""))); return out; }
  if (Array.isArray(obj)) { obj.forEach((x) => collectNumbers(x, out)); return out; }
  if (typeof obj === "object") Object.values(obj).forEach((x) => collectNumbers(x, out));
  return out;
}

/** Number guard: every number in model text must exist in the tool output (or be a whitelisted constant). */
export function numberGuard(text, allowed) {
  const whitelist = new Set([...allowed, 30, 15, 37, 14, 52, 2019, 35, 2026, 100, 0, 1, 2, 3]);
  const bad = [];
  for (const m of text.matchAll(/\d[\d.,]*\d|\d/g)) {
    let raw = m[0];
    // thousands separators "54,999" / "54.999" -> 54999 ; keep decimals like "12.5"
    let n = /^\d{1,3}([.,]\d{3})+$/.test(raw) ? Number(raw.replace(/[.,]/g, "")) : Number(raw.replace(/,/g, ""));
    if (Number.isNaN(n)) continue;
    const ok = [...whitelist].some((a) => Math.abs(a - n) <= Math.max(0.51, Math.abs(a) * 0.001));
    if (!ok) bad.push(raw);
  }
  return { ok: bad.length === 0, bad };
}

/** PriceScout: Serbian average (synthetic retailers) vs synthetic world reference prices, and the cheapest offer. */
export function priceScout(history, productId, offers, world, fx, bfDate) {
  const mean = (xs) => Math.round(xs.reduce((a, b) => a + b, 0) / (xs.length || 1));
  const from = addDays(bfDate, -30);
  const cur = offers.map((o) => ({ retailerId: o.retailerId, offerId: o.id, price: o.bfPrice }));
  const hist = offers.flatMap((o) => (history[`${o.retailerId}:${productId}`] || []).filter((r) => r.d >= from && r.d < bfDate).map((r) => ({ ...r, retailerId: o.retailerId })));
  const cheapest = cur.reduce((m, r) => (r.price < m.price ? r : m), cur[0]);
  const avgNow = mean(cur.map((r) => r.price));
  const wrows = world.filter((w) => w.productId === productId).map((w) => {
    const rate = fx.rates[w.currency];
    return { ...w, rate, rsd: N(Math.round(w.price * rate), [`world:${w.id}`, `fx:${w.currency}`], `${w.price} ${w.currency} × ${rate} RSD/${w.currency} (approximate fixed rate)`) };
  });
  const worldAvg = wrows.length ? mean(wrows.map((w) => w.rsd.v)) : null;
  return {
    productId,
    serbia: {
      shops: cur.length,
      avgNow: N(avgNow, cur.map((r) => offerRef(r.offerId)), `mean of the current offers at ${cur.length} Serbian retailers (fictional, synthetic feed)`),
      avg30: N(mean(hist.map((r) => r.p)), [...new Set(hist.map((r) => histRef(r.retailerId, productId)))], `mean of ${hist.length} daily prices ${from}…${addDays(bfDate, -1)} across those retailers`),
      rows: cur,
    },
    world: worldAvg === null ? null : {
      markets: wrows.length,
      avg: N(worldAvg, wrows.map((w) => `world:${w.id}`).concat([...new Set(wrows.map((w) => `fx:${w.currency}`))]), `mean of ${wrows.length} synthetic world reference prices converted to RSD with approximate fixed rates`),
      rows: wrows.map(({ id, market, country, currency, price, rate, rsd }) => ({ id, market, country, currency, price, rate, rsd })),
    },
    cheapest: { retailerId: cheapest.retailerId, offerId: cheapest.offerId, price: N(cheapest.price, offerRef(cheapest.offerId), "lowest current offer in the feed") },
    serbiaVsWorld: worldAvg === null ? null : N(avgNow - worldAvg, cur.map((r) => offerRef(r.offerId)).concat(wrows.map((w) => `world:${w.id}`)), "Serbian average − world average (positive = Serbia is more expensive)"),
  };
}

/** Timeline statistics for a run, from its task records (the same numbers the timeline draws). */
export function runStats(tasks, startedAt, completedAt) {
  const asyncT = tasks.filter((t) => t.kind !== "sync");
  const ev = asyncT.flatMap((t) => [[t.start, 1], [t.end ?? Infinity, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let c = 0, peak = 0; for (const [, d] of ev) { c += d; peak = Math.max(peak, c); }
  const workers = tasks.flatMap((t) => t.steps.filter((s) => s.kind === "worker" && s.end));
  const wev = workers.flatMap((s) => [[s.start, 1], [s.end, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let wc = 0, wpeak = 0; for (const [, d] of wev) { wc += d; wpeak = Math.max(wpeak, wc); }
  const byAgent = {};
  for (const t of tasks) byAgent[t.agent] = (byAgent[t.agent] || 0) + 1;
  return {
    tasks: tasks.length, asyncTasks: asyncT.length, peakConcurrency: peak, workerJobs: workers.length, peakParallelWorkers: wpeak,
    loops: tasks.filter((t) => t.kind === "loop").length,
    inferenceSteps: tasks.reduce((a, t) => a + t.steps.filter((s) => s.kind === "inference").length, 0),
    superseded: tasks.filter((t) => t.status === "superseded").length,
    interceptions: tasks.filter((t) => t.interception).length,
    rewrites: tasks.filter((t) => t.interception?.changed).length,
    agentsActive: Object.keys(byAgent).length, byAgent,
    runMs: completedAt ? Math.round(completedAt - startedAt) : null,
  };
}
