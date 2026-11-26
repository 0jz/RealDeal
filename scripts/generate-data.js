// Deterministic generator for the SYNTHETIC dataset used by the demo.
// Every retailer, product, price and listing below is fictional. Run: npm run data
// The output in ./data is committed, so the demo never depends on this script running.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data");
const SEED = 20261127;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => a + rand() * (b - a);
const round99 = (x) => Math.max(99, Math.round(x / 500) * 500 - 1);

export const BF_DATE = "2026-11-27";
const HISTORY_DAYS = 60; // 2026-09-28 .. 2026-11-26
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const START = addDays(BF_DATE, -HISTORY_DAYS);

const retailers = [
  { id: "r1", name: "TehnoKutak", factor: 1.0, note: "fictional" },
  { id: "r2", name: "MegaMarket Plus", factor: 1.02, note: "fictional" },
  { id: "r3", name: "Elektro Zvezda", factor: 0.99, note: "fictional" },
  { id: "r4", name: "DigiPolis", factor: 0.97, note: "fictional" },
  { id: "r5", name: "KupiBrzo.rs", factor: 1.05, note: "fictional" },
];
const F = Object.fromEntries(retailers.map((r) => [r.id, r.factor]));

// scenario per (product, retailer):
//  honest     – before price = true 30-day minimum, real discount
//  inflated   – price hiked ~2 weeks before BF, "before" = hiked price  (likely violation)
//  partial    – had a short promo inside the 30-day window, "before" ignores it (likely violation)
//  stale      – "before" is a price from >30 days ago (likely violation)
//  newlisting – product in assortment < 30 days (15-day rule applies), honest
//  cycle      – recurring promo dips, NO Black Friday discount advertised (feeds the "wait N days" heuristic)
const products = [
  { id: "p01", name: "Orbis Phone 12 128GB", category: "Phones", base: 64999, offers: { r1: "honest", r4: "honest", r5: "inflated" }, featured: "r5", kp: { sealed: 2, used: 2, variant: "Orbis Phone 12 Pro 256GB", accessory: "Maska za Orbis Phone 12" } },
  { id: "p02", name: "Lumen 55\" 4K TV QL55", category: "TV", base: 59999, offers: { r2: "cycle", r3: "partial", r5: "inflated" }, featured: "r5", kp: { sealed: 1, used: 2, variant: "Lumen 65\" 4K TV QL65", accessory: "Zidni nosac za Lumen QL55" } },
  { id: "p03", name: "Vetra Robot Vacuum S7", category: "Home", base: 34999, offers: { r1: "honest", r3: "stale", r4: "honest" }, featured: "r3", kp: { sealed: 1, used: 1, variant: "Vetra Robot Vacuum S7 Max", accessory: "Filteri za Vetra S7 set" } },
  { id: "p04", name: "Kora Air Fryer XL 6L", category: "Kitchen", base: 11999, offers: { r2: "honest", r3: "honest", r5: "inflated" }, featured: "r5", kp: { sealed: 2, used: 1, variant: "Kora Air Fryer 4L", accessory: "Papir za Kora air fryer" } },
  { id: "p05", name: "Nimbus Laptop 14 16GB 512GB", category: "Laptops", base: 89999, offers: { r1: "partial", r2: "cycle", r4: "honest" }, featured: "r1", kp: { sealed: 1, used: 2, variant: "Nimbus Laptop 16 32GB 1TB", accessory: "Torba za Nimbus Laptop 14" } },
  { id: "p06", name: "Sonar H900 ANC Headphones", category: "Audio", base: 24999, offers: { r3: "inflated", r4: "cycle", r5: "inflated" }, featured: "r3", kp: { sealed: 2, used: 2, variant: "Sonar H700 slusalice", accessory: "Jastucici za Sonar H900" } },
  { id: "p07", name: "Pixa Z50 Mirrorless Camera Kit", category: "Cameras", base: 109999, offers: { r1: "honest", r2: "honest" }, featured: "r2", kp: { sealed: 0, used: 2, variant: "Pixa Z30 telo", accessory: "Baterija za Pixa Z50" } },
  { id: "p08", name: "Brio B2 Espresso Machine", category: "Kitchen", base: 39999, offers: { r2: "partial", r4: "honest", r5: "inflated" }, featured: "r5", kp: { sealed: 1, used: 1, variant: "Brio B1 aparat za espresso", accessory: "Kafa u zrnu za Brio" } },
  { id: "p09", name: "Atlas Game Console 1TB", category: "Gaming", base: 64999, offers: { r1: "honest", r3: "honest", r4: "cycle" }, featured: "r1", kp: { sealed: 2, used: 2, variant: "Atlas Game Console Slim 512GB", accessory: "Dzojstik za Atlas konzolu" } },
  { id: "p10", name: "Flux W3 Smartwatch", category: "Wearables", base: 21999, offers: { r2: "honest", r4: "newlisting" }, featured: "r4", kp: { sealed: 1, used: 1, variant: "Flux W2 sat", accessory: "Narukvica za Flux W3" } },
  { id: "p11", name: "Kora Stick Blender 1000W", category: "Kitchen", base: 5999, offers: { r1: "honest", r3: "inflated" }, featured: "r3", kp: { sealed: 0, used: 1, variant: "Kora mikser 600W", accessory: "Nastavak za Kora stapni mikser" } },
  { id: "p12", name: "Tera External SSD 2TB", category: "Storage", base: 17999, offers: { r2: "cycle", r4: "honest", r5: "inflated" }, featured: "r5", kp: { sealed: 2, used: 1, variant: "Tera External SSD 1TB", accessory: "Kabl za Tera SSD" } },
  { id: "p13", name: "Orbis Tablet 11 128GB", category: "Tablets", base: 44999, offers: { r1: "honest", r3: "partial" }, featured: "r3", kp: { sealed: 1, used: 2, variant: "Orbis Tablet 11 256GB", accessory: "Futrola za Orbis Tablet 11" } },
  { id: "p14", name: "Vetra V12 Cordless Vacuum", category: "Home", base: 49999, offers: { r1: "honest", r2: "cycle", r4: "partial" }, featured: "r4", kp: { sealed: 1, used: 1, variant: "Vetra V10 usisivac", accessory: "Baterija za Vetra V12" } },
];

const history = {}; // "r1:p01" -> [{d, p}]
const offersPage1 = [];
let gtinCounter = 860000000000;

for (const p of products) {
  p.gtin = "SYN" + String(gtinCounter += 1013);
  for (const [rid, scenario] of Object.entries(p.offers)) {
    const normal = p.base * F[rid] * between(0.99, 1.01);
    const series = [];
    let level = normal;
    const firstDay = scenario === "newlisting" ? 40 : 0;
    const cycleOffset = Math.floor(between(2, 8));
    for (let day = firstDay; day < HISTORY_DAYS; day++) {
      if (day % 10 === 0 && day > 0) level = normal * between(0.98, 1.02); // small re-pricings
      let price = level;
      if (scenario === "inflated" && day >= 46) price = normal * 1.3;
      if (scenario === "partial" && day >= 38 && day <= 42) price = normal * 0.82;
      if (scenario === "stale" && day <= 20) price = normal * 1.15;
      if (scenario === "cycle" && (day - cycleOffset) % 24 >= 0 && (day - cycleOffset) % 24 < 4) price = normal * 0.86;
      series.push({ d: addDays(START, day), p: round99(price) });
    }
    history[`${rid}:${p.id}`] = series;
    const window = series.filter((r) => r.d >= addDays(BF_DATE, -30));
    const min30 = Math.min(...(scenario === "newlisting" ? series : window).map((r) => r.p));
    const regular = round99(normal);
    let before, bf;
    switch (scenario) {
      case "inflated": before = round99(normal * 1.3); bf = round99(normal * (rid === "r5" ? 0.93 : 1.0)); break;
      case "partial": before = regular; bf = round99(normal * 0.9); break;
      case "stale": before = round99(normal * 1.15); bf = round99(normal * 0.93); break;
      case "cycle": before = null; bf = round99(series[series.length - 1].p); break;
      default: before = min30; bf = round99(min30 * between(0.84, 0.93));
    }
    offersPage1.push({ id: `o1-${rid}-${p.id}`, page: 1, retailerId: rid, productId: p.id, advertisedBefore: before, bfPrice: bf, publishedAt: `${BF_DATE}T00:00:00+01:00` });
  }
}

// The shady fictional retailer (r5) undercuts everyone on the BF price while faking the "before" price.
for (const o of offersPage1.filter((o) => o.retailerId === "r5")) {
  const others = offersPage1.filter((x) => x.productId === o.productId && x.retailerId !== "r5");
  o.bfPrice = round99(Math.min(...others.map((x) => x.bfPrice)) * 0.97);
}

// Late feed pages: price changes published after the first page (synthetic).
const changePrice = (page, rid, pid, factor, at) => {
  const base = offersPage1.find((o) => o.retailerId === rid && o.productId === pid);
  return { ...base, id: `o${page}-${rid}-${pid}`, page, bfPrice: round99(base.bfPrice * factor), publishedAt: `${BF_DATE}T${at}:00+01:00`, replaces: base.id };
};
const offersPage2 = [changePrice(2, "r4", "p01", 0.99, "00:20"), changePrice(2, "r2", "p12", 1.04, "00:25"), changePrice(2, "r1", "p09", 1.03, "00:30"), changePrice(2, "r2", "p02", 0.97, "00:35")];
const offersPage3 = [changePrice(3, "r2", "p04", 0.94, "09:00"), changePrice(3, "r4", "p06", 0.95, "09:10"), changePrice(3, "r4", "p05", 0.97, "09:15"), changePrice(3, "r1", "p03", 0.96, "09:20")];

// KupujemProdajem-style second-hand listings (synthetic).
const cities = ["Beograd", "Novi Sad", "Nis", "Kragujevac", "Subotica", "Cacak", "Pancevo", "Zrenjanin", "Kraljevo", "Smederevo"];
const sealedWords = ["NOVO, zapakovano", "nov neotpakovan", "NOV u celofanu", "novo sa racunom, zapakovano"];
const usedWords = ["koriscen 3 meseca", "polovan, ocuvan", "malo koriscen", "kao nov, bez kutije"];
const kp = [];
let kpId = 1;
const kpRow = (title, price, condition, productHint) => {
  const id = "kp-" + String(kpId++).padStart(6, "0");
  kp.push({ id, title, price: Math.round(price / 100) * 100, condition, city: pick(cities), postedAt: addDays(BF_DATE, -Math.floor(between(0, 20))), sellerRating: Math.round(between(88, 100)), productHint });
};
for (const p of products) {
  const newMin = Math.min(...Object.keys(p.offers).map((rid) => p.base * F[rid]));
  for (let i = 0; i < p.kp.sealed; i++) kpRow(`${p.name} ${pick(sealedWords)}`, newMin * between(0.8, 0.9), "sealed", p.id);
  for (let i = 0; i < p.kp.used; i++) kpRow(`${p.name} ${pick(usedWords)}`, newMin * between(0.58, 0.72), "used", p.id);
  kpRow(`${p.kp.variant} ${pick(sealedWords)}`, newMin * between(1.05, 1.25), "sealed", "variant");
  kpRow(`${p.kp.accessory} nov`, Math.max(600, newMin * between(0.02, 0.06)), "new-accessory", "accessory");
}
// background noise: unrelated listings, so matching is a real search problem
const brands = ["Orbis", "Lumen", "Vetra", "Kora", "Nimbus", "Sonar", "Pixa", "Brio", "Atlas", "Flux", "Tera", "Nova", "Zenit", "Polar", "Delta", "Iskra", "Morava", "Sava"];
const things = ["frizider", "ves masina", "bicikl", "kauc", "stolica", "monitor 27", "tastatura", "mis", "ruter", "zvucnik", "lampa", "kosilica", "fen", "pegla", "mikrotalasna", "sporet", "klima", "telefon 64GB", "tablet 64GB", "punjac", "slusalice", "sat", "kamera", "objektiv 50mm", "konzola 500GB", "laptop 8GB", "SSD 512GB", "TV 43", "usisivac", "blender"];
const extras = ["hitno", "povoljno", "zamena", "kao nov", "garancija", "dostava", "fiksno", "nov", "polovan", "ispravan", "", ""];
for (let i = 0; i < 12000; i++) {
  kpRow(`${pick(brands)} ${pick(things)} ${pick(extras)}`.trim(), between(800, 120000), rand() < 0.3 ? "sealed" : "used", "noise");
}

const lists = [
  { id: "family", name: "Family Black Friday list", note: "Ads the shopper saw (synthetic)", items: [["p02", "r5"], ["p04", "r5"], ["p08", "r5"], ["p03", "r3"], ["p11", "r3"], ["p09", "r1"], ["p14", "r4"]] },
  { id: "tech", name: "Tech upgrades list", note: "Ads the shopper saw (synthetic)", items: [["p01", "r5"], ["p05", "r1"], ["p06", "r3"], ["p10", "r4"], ["p12", "r5"], ["p13", "r3"], ["p07", "r2"]] },
  { id: "all", name: "Everything in the feed", note: "Each product at its featured ad", items: products.map((p) => [p.id, p.featured]) },
].map((l) => ({ ...l, items: l.items.map(([productId, retailerId]) => ({ productId, retailerId })) }));

const write = (name, obj) => { const f = join(OUT, name); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(obj, null, name.includes("kp-") || name.includes("history") ? 0 : 2)); };
const meta = { synthetic: true, seed: SEED, generatedBy: "scripts/generate-data.js", bfDate: BF_DATE, historyFrom: START, historyTo: addDays(BF_DATE, -1), currency: "RSD", note: "All retailers, products, prices and listings are fictional and generated from a fixed seed." };
write("meta.json", meta);
write("retailers.json", retailers.map(({ id, name, note }) => ({ id, name, note })));
// Scannable barcodes: EAN-13 in the GS1 "restricted circulation" range 200-299 (for in-store/internal use),
// so they can never collide with a real product's barcode. Deterministic, no random numbers involved.
const ean13 = (body12) => { const d = body12.split("").map(Number); const sum = d.reduce((a, x, i) => a + x * (i % 2 ? 3 : 1), 0); return body12 + ((10 - (sum % 10)) % 10); };
products.forEach((p, i) => { p.ean13 = ean13("2008600" + String(i + 1).padStart(5, "0")); });
write("products.json", products.map(({ id, name, category, gtin, ean13, featured }) => ({ id, name, category, gtin, ean13, featuredRetailer: featured })));

// Synthetic "world reference prices" for the scanner (separate RNG stream so the data above is unchanged).
// NOT real market prices. Exchange rates are approximate, fixed values used only to convert this synthetic data.
const fx = {
  note: "Approximate fixed rates (RSD per 1 unit) used only to convert the SYNTHETIC world reference prices. Not live and not official; official rates: National Bank of Serbia, https://www.nbs.rs/en/finansijsko_trziste/informacije-za-javnost/kursna-lista/",
  asOf: "approximate, 2025-2026 range",
  rates: { RSD: 1, EUR: 117.2, USD: 101.5, HUF: 0.30, PLN: 27.4, GBP: 139.0 },
};
const markets = [["DE", "Germany", "EUR"], ["AT", "Austria", "EUR"], ["HR", "Croatia", "EUR"], ["HU", "Hungary", "HUF"], ["PL", "Poland", "PLN"], ["UK", "United Kingdom", "GBP"], ["US", "United States", "USD"]];
const rand2 = mulberry32(SEED + 1);
const world = [];
for (const p of products) {
  const chosen = markets.filter(() => rand2() < 0.75);
  for (const [code, country, currency] of (chosen.length >= 3 ? chosen : markets.slice(0, 4))) {
    const rsd = p.base * (0.82 + rand2() * 0.36);
    const local = currency === "HUF" ? Math.round(rsd / fx.rates.HUF / 100) * 100 : Number((Math.round(rsd / fx.rates[currency] * 2) / 2 - 0.01).toFixed(2));
    world.push({ id: `w-${p.id}-${code}`, productId: p.id, ean13: p.ean13, market: code, country, currency, price: local, observedAt: "2026-11-20", note: "synthetic" });
  }
}
write("world-prices.json", world);
write("fx-rates.json", fx);
write("history.json", history);
write("feed/page-1.json", offersPage1);
write("feed/page-2.json", offersPage2);
write("feed/page-3.json", offersPage3);
write("kp-listings.json", kp);
write("lists.json", lists);
console.log(`synthetic data written to ${OUT}: ${products.length} products, ${offersPage1.length} offers, ${Object.values(history).reduce((a, s) => a + s.length, 0)} history rows, ${kp.length} KP listings`);
