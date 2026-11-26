// Seeded generator for the offline fixtures in data/fixtures/*.json.
// Everything here is synthetic: fictional shops, invented sellers, and listing
// URLs under a /fixture/ path that no real site serves. Run: npm run fixtures

import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { CATALOGUE } from "../../search/catalogue"
import type { Category, Condition, Product, RawListing } from "../../search/types"

const SEED = 2026
const HISTORY_DAYS = 60

export type Rng = () => number
export type Fixtures = { kp: RawListing[]; eponuda: RawListing[]; cenoteka: RawListing[] }

export function mulberry32(seed: number): Rng {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

const int = (r: Rng, min: number, max: number) => min + Math.floor(r() * (max - min + 1))
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T
const chance = (r: Rng, p: number) => r() < p
const round = (n: number, step: number) => Math.round(n / step) * step

const WEIGHT: Record<Category, number> = { phone: 3, console: 1.5, laptop: 1, tablet: 0.7, headphones: 0.8, tv: 0.5, gpu: 0.7, watch: 0.5 }

function pickWeighted(r: Rng, items: Product[], weight: (p: Product) => number): Product {
	const total = items.reduce((s, p) => s + weight(p), 0)
	let x = r() * total
	for (const p of items) {
		x -= weight(p)
		if (x < 0) return p
	}
	return items[items.length - 1] as Product
}

// ---- Words the way Serbian sellers write them ----

const CITIES = ["Beograd", "Novi Sad", "Niš", "Kragujevac", "Subotica", "Čačak", "Šabac", "Zrenjanin"]
const SELLERS = ["mare_bg", "tehno_kutak", "zoki93", "ns_digital", "kupi_nis", "gaga.shop", "pixel_kg", "sale_sub", "milica.r", "bgmarket77", "stari_kompjuter", "kutak_tech"]

const CONDITION_WORDS: Record<Condition, string[]> = {
	used: ["polovan", "korišćen", "kao nov", "ocuvan", "polovno"],
	new: ["nov", "neotpakovan", "nov neotpakovan", "novo"],
	sealed: ["zapakovan", "sealed", "zapečaćen", "nov zapakovan"],
}

const DESC: Record<Condition, string[]> = {
	used: ["Ispravan, bez ogrebotina na ekranu. Racun i punjac u paketu. Cena fiksna.", "Stanje kao na slikama, baterija 90%. Licno preuzimanje ili posta.", "Koriscen kratko, sa futrolom. Zamena moguca uz doplatu."],
	new: ["Nov, neotpakovan, garancija 24 meseca. Moguca dostava postom.", "Zapakovan, originalan racun, PDV uracunat."],
	sealed: ["Zapakovan u fabricku foliju, racun u paketu.", "Sealed, garancija 24 meseca, dostava u Srbiji."],
}

const CYR: Record<string, string> = {
	iphone: "Ајфон", ajfon: "Ајфон", pro: "про", max: "макс", gb: "гб", kao: "као", nov: "нов", ocuvan: "очуван", polovan: "полован",
	samsung: "Самсунг", playstation: "Плејстејшн", ps5: "ПС5", telefon: "телефон", macbook: "мекбук", airpods: "ерподс",
}
const cyrillicize = (title: string) => title.split(" ").map((w) => CYR[w.toLowerCase()] ?? w).join(" ")

// Brand words that sellers misspell. Our literal site search will not correct these.
const BRAND_TYPOS: Array<[RegExp, string[]]> = [
	[/iphone/i, ["ifone", "ajfon", "iphon", "ajfone", "ifon"]],
	[/samsung/i, ["samsumg", "samsng", "samsun"]],
	[/galaxy/i, ["galaksi", "galaxi"]],
	[/playstation/i, ["plejstejsn", "plejstejšn", "plejstejn"]],
	[/macbook/i, ["mekbuk", "makbuk", "mekbok"]],
	[/airpods/i, ["erpods", "ajrpods"]],
	[/xiaomi/i, ["ksiaomi", "sjaomi", "xiomi"]],
	[/ipad/i, ["ajped", "ipd"]],
]

function brandTypo(r: Rng, name: string): string {
	for (const [re, subs] of BRAND_TYPOS) if (re.test(name) && chance(r, 0.4)) return name.replace(re, pick(r, subs))
	return name
}

function typo(r: Rng, s: string): string {
	const letters = [...s.matchAll(/[a-z]/gi)].map((m) => m.index as number)
	if (letters.length < 3) return s
	const i = pick(r, letters)
	const op = int(r, 0, 2)
	if (op === 0) return s.slice(0, i) + s.slice(i + 1) // dropped letter
	if (op === 1) return s.slice(0, i) + s[i] + s.slice(i) // doubled letter
	return s.slice(0, i) + (s[i + 1] ?? "") + s[i] + s.slice(i + 2) // swapped neighbours
}

function nameVariant(r: Rng, p: Product): string {
	const forms = [p.model, p.model.toLowerCase(), p.model.replace(/\s+/g, ""), ...(p.aliases ?? [])]
	let name = pick(r, forms)
	if (chance(r, 0.3)) name = `${p.brand} ${name}`
	if (chance(r, 0.35)) name = brandTypo(r, name)
	if (chance(r, 0.12)) name = typo(r, name)
	return name
}

function storageText(r: Rng, gb: number): string {
	if (gb >= 1024) return pick(r, [`${gb / 1024}tb`, `${gb / 1024} TB`])
	return pick(r, [`${gb}gb`, `${gb} GB`, `${gb}GB`, `${gb}g`, `${gb}`])
}

// ---- KP classifieds ----

/** Look-alikes: listings that mention the product but are not the product. */
type Decoy = { title: (m: string) => string; price: (msrp: number, r: Rng) => number; desc: string }
const DECOYS: Decoy[] = [
	{ title: (m) => `Maska za ${m}`, price: (_, r) => int(r, 8, 25) * 100, desc: "Silikonska maska, nije telefon." },
	{ title: (m) => `Zastitno staklo za ${m}`, price: (_, r) => int(r, 5, 15) * 100, desc: "Kaljeno staklo, stavljeno na foliju." },
	{ title: (m) => `Kutija od ${m}`, price: (_, r) => int(r, 5, 20) * 100, desc: "Samo kutija sa uputstvom, bez uredjaja." },
	{ title: (m) => `${m} za delove`, price: (msrp, r) => round(msrp * (0.15 + r() * 0.2), 100), desc: "Ne pali se, za delove." },
	{ title: (m) => `${m} iCloud lock`, price: (_, r) => round(int(r, 80, 150) * 100, 100), desc: "Zakljucan na nalog, prodajem kako stoji." },
	{ title: (m) => `Replika ${m}`, price: (_, r) => round(int(r, 80, 250) * 100, 500), desc: "Kvalitetna kopija, nije original." },
	{ title: (m) => `Kupujem ${m}`, price: (msrp) => round(msrp * 0.9, 500), desc: "Placam odmah, ispravan uredjaj." },
	{ title: (m) => `Punjac za ${m} 20W`, price: (_, r) => int(r, 12, 30) * 100, desc: "Originalni punjac, ispravan." },
	{ title: (m) => `Kabl za ${m} tip C`, price: (_, r) => int(r, 4, 15) * 100, desc: "Nov kabl, 1 metar." },
	{ title: (m) => `Futrola za ${m} providna`, price: (_, r) => int(r, 5, 15) * 100, desc: "Providna silikonska futrola." },
]

/** Asking price as a share of msrp: used 55-80%, new/sealed 85-100%, some scam-cheap and some overpriced. */
function kpPrice(r: Rng, p: Product, storageIdx: number, cond: Condition): number {
	const base = p.msrp * (1 + 0.12 * storageIdx)
	let f = cond === "used" ? 0.55 + r() * 0.25 : 0.85 + r() * 0.15
	if (chance(r, 0.05)) f = 0.27 + r() * 0.06
	else if (chance(r, 0.05)) f = 1.15 + r() * 0.15
	return round(base * f, chance(r, 0.5) ? 500 : 100)
}

function kpListing(r: Rng, i: number): RawListing {
	const id = String(1000000 + i * 7 + int(r, 0, 6))
	const p = pickWeighted(r, CATALOGUE, (x) => WEIGHT[x.category])
	const common = {
		source: "kp",
		id,
		url: `https://www.kupujemprodajem.com/fixture/${id}`,
		shipping: chance(r, 0.5) ? null : 300 + 50 * int(r, 0, 8),
		city: chance(r, 0.05) ? null : pick(r, CITIES),
		seller: { name: `${pick(r, SELLERS)}${chance(r, 0.5) ? int(r, 1, 99) : ""}`, rating: int(r, 70, 100), reviews: int(r, 0, 400) },
	}
	if (chance(r, 0.15)) {
		const d = pick(r, DECOYS)
		return { ...common, title: d.title(p.model), description: d.desc, price: round(d.price(p.msrp, r), 100), condition: null }
	}
	const condition: Condition = chance(r, 0.6) ? "used" : chance(r, 0.6) ? "new" : "sealed"
	const storageIdx = p.storages ? int(r, 0, p.storages.length - 1) : 0
	const gb = p.storages?.[storageIdx] ?? null
	const parts = [nameVariant(r, p)]
	if (gb !== null && chance(r, 0.7)) parts.push(storageText(r, gb))
	if (chance(r, 0.8)) parts.push(pick(r, CONDITION_WORDS[condition]))
	let title = parts.length > 1 && chance(r, 0.3) ? parts.reverse().join(" ") : parts.join(" ")
	if (p.category === "console" && chance(r, 0.35)) title += pick(r, [" + igrica", " + 2 kontrolera", " sa kutijom", " + garancija"])
	if (chance(r, 0.25)) title = title.toUpperCase()
	if (["Apple", "Samsung", "Sony"].includes(p.brand) && chance(r, 0.08)) title = cyrillicize(title)
	return {
		...common,
		title,
		description: chance(r, 0.15) ? null : pick(r, DESC[condition]),
		price: kpPrice(r, p, storageIdx, condition),
		condition: chance(r, 0.85) ? condition : null,
	}
}

// ---- Shop offers (eponuda, cenoteka) ----

type Shop = { id: string; name: string; fake: number; honest: number; inflated: number }
// `fake` = share of offers with a fake "-40%" after a pre-sale hike. DigiMax does this far more than the rest.
const SHOPS: Shop[] = [
	{ id: "tehnomax", name: "TehnoMax", fake: 0.12, honest: 0.22, inflated: 0.08 },
	{ id: "digimax", name: "DigiMax", fake: 0.55, honest: 0.1, inflated: 0.1 },
	{ id: "byteshop", name: "ByteShop", fake: 0.05, honest: 0.25, inflated: 0.05 },
	{ id: "voltzona", name: "VoltZona", fake: 0.1, honest: 0.2, inflated: 0.1 },
	{ id: "spectramarket", name: "SpectraMarket", fake: 0.06, honest: 0.25, inflated: 0.06 },
]
const CENOTEKA_SHOPS = SHOPS.filter((s) => ["tehnomax", "byteshop", "voltzona"].includes(s.id))
const CENOTEKA_POOL = CATALOGUE.filter((p) => ["headphones", "tv", "phone"].includes(p.category))

function shopListings(r: Rng, source: "eponuda" | "cenoteka", count: number, pool: Product[], weight: (p: Product) => number, shops: Shop[]): RawListing[] {
	const out: RawListing[] = []
	const seen = new Set<string>()
	while (out.length < count) {
		const p = pickWeighted(r, pool, weight)
		const storageIdx = p.storages ? int(r, 0, p.storages.length - 1) : 0
		const gb = p.storages?.[storageIdx] ?? null
		const shop = pick(r, shops)
		const key = `${p.id}|${gb}|${shop.id}`
		if (seen.has(key)) continue
		seen.add(key)

		const id = `${source}-${String(out.length + 1).padStart(4, "0")}`
		const base = p.msrp * (1 + 0.12 * storageIdx) * (0.92 + r() * 0.12)
		const fresh = chance(r, 0.1) // "new in stock": no history before it arrived
		const u = r()
		const pattern = fresh ? "none" : u < shop.fake ? "hike" : u < shop.fake + shop.inflated ? "inflated" : u < shop.fake + shop.inflated + shop.honest ? "honest" : "none"

		const series: (number | null)[] = Array.from({ length: HISTORY_DAYS }, () => round(base * (0.985 + r() * 0.03), 100))
		if (fresh) {
			const missing = int(r, 5, 25)
			for (let d = 0; d < missing; d++) series[d] = null
		}
		// `series` is the price history up to the day BEFORE the sale; today's sale price is separate.
		// The 30-day rule compares the advertised previous price with the lowest price in that history.
		if (pattern === "hike") for (let d = 45; d < HISTORY_DAYS; d++) series[d] = round(base * 1.67, 100) // hiked just before the "sale"

		const last = series[HISTORY_DAYS - 1] as number
		const low30 = Math.min(...series.slice(-30).filter((x): x is number => x !== null))
		const priceNow =
			pattern === "honest" ? round(low30 * 0.9, 100) // a real 10% cut from the 30-day low
			: pattern === "hike" ? round(last * 0.6, 100) // "-40%" off the hiked price ≈ the normal price
			: pattern === "inflated" ? round(low30 * 0.95, 100)
			: last
		const shownPrev =
			pattern === "honest" ? low30
			: pattern === "hike" ? last
			: pattern === "inflated" ? round(low30 * (1.15 + r() * 0.1), 100)
			: priceNow

		out.push({
			source,
			id,
			url: `https://www.${source === "eponuda" ? "eponuda.rs" : "cenoteka.rs"}/fixture/${id}`,
			title: `${p.brand} ${p.model}${gb ? ` ${gb}GB` : ""}`,
			description: `${p.brand} ${p.model}${gb ? `, ${gb}GB` : ""}. Originalno pakovanje, garancija 24 meseca. Isporuka iz skladista ${shop.name}.`,
			price: priceNow,
			shipping: chance(r, 0.4) ? 0 : 390 + 10 * int(r, 0, 20),
			condition: "new",
			city: null,
			seller: null,
			shopId: shop.id,
			shopName: shop.name,
			history: series,
			shownPrevPrice: shownPrev,
		})
	}
	return out
}

// ---- Entry points ----

export function generate(): Fixtures {
	const r = mulberry32(SEED)
	const kp = Array.from({ length: 600 }, (_, i) => kpListing(r, i))
	const eponuda = shopListings(r, "eponuda", 250, CATALOGUE, (p) => WEIGHT[p.category], SHOPS)
	const cenoteka = shopListings(r, "cenoteka", 80, CENOTEKA_POOL, (p) => (p.category === "phone" ? 0.3 : 1), CENOTEKA_SHOPS)
	return { kp, eponuda, cenoteka }
}

/** One listing per line, so the files stay diffable. */
export async function writeFixtures(dir = resolve(process.cwd(), "data/fixtures")): Promise<Fixtures> {
	const data = generate()
	await mkdir(dir, { recursive: true })
	for (const [name, rows] of Object.entries(data)) {
		const file = resolve(dir, `${name}.json`)
		await writeFile(file, `[\n${rows.map((row) => JSON.stringify(row)).join(",\n")}\n]\n`, "utf8")
		console.log(`${name}: ${rows.length} listings -> ${file}`)
	}
	return data
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await writeFixtures()
