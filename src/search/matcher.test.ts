import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { detectCondition, expandQuery, matchTitle, resolveQuery } from "./matcher"
import { extractStorage, normalize } from "./normalize"

// Labelled classified titles: [title, expected product id or null, optional description].

const CASES: Array<[string, string | null, string?]> = [
	// iPhone: misspellings, Cyrillic, joined numbers, family members
	["Iphone 15 Pro 256GB kao nov", "iphone-15-pro"],
	["Ajfon 15 Pro Maks 256", "iphone-15-pro-max"],
	["Ајфон 15 Про 256гб", "iphone-15-pro"],
	["Ifone 15 pro maks 256gb", "iphone-15-pro-max"],
	["iPhone 15 pm 256", "iphone-15-pro-max"],
	["iPhone 15 Pro Max 1TB", "iphone-15-pro-max"],
	["Iphon 14 128gb plava", "iphone-14"],
	["Iphone14 128", "iphone-14"],
	["iPhone 13 128GB polovan", "iphone-13"],
	["IPHONE 16 PRO 128GB", "iphone-16-pro"],
	["iPhone 17 256GB nov", "iphone-17"],
	["Aifon 17 512GB sealed", "iphone-17"],
	["iPhone 15 128gb", "iphone-15"],
	["ajfon 15 128", "iphone-15"],
	["Iphnoe 15 Pro 256", "iphone-15-pro"],
	["Iphone 15 Pro 256 nije zakljucan", "iphone-15-pro"],
	["iPhone 15 Pro 256", "iphone-15-pro", "ekran nije razbijen, nije zakljucan"],
	// Samsung
	["Samsumg s24 ultra 512gb kao nov", "galaxy-s24-ultra"],
	["S24 Ultra 512", "galaxy-s24-ultra"],
	["Samsung S24 256GB", "galaxy-s24"],
	["samsun galaksi s25 256", "galaxy-s25"],
	["Galaxy S23 128 gb crni", "galaxy-s23"],
	["Samsung A55 5G 128GB", "galaxy-a55"],
	["samung a35 256", "galaxy-a35"],
	["Samsung 55CU7172 4K", "samsung-55-cu7172"],
	["Galaxy Tab S9 FE 128", "galaxy-tab-s9-fe"],
	["Galaxy Buds2 Pro crne", "galaxy-buds2-pro"],
	// Xiaomi, Google
	["Xiaomi 14 512gb", "xiaomi-14"],
	["sjaomi 14 256", "xiaomi-14"],
	["Redmi Note 13 Pro 256GB", "redmi-note-13-pro"],
	["Google Pixel 9 128GB", "pixel-9"],
	["piksel 8 256", "pixel-8"],
	// PlayStation, Xbox, Nintendo
	["PS5 slim dig + 2 dzojstika", "ps5-slim-digital"],
	["PS5 Digital Edition", "ps5-slim-digital"],
	["РС5 digital", "ps5-slim-digital"],
	["PlayStation 5 Pro 2TB", "ps5-pro"],
	["Sony PlayStation 5 Pro", "ps5-pro"],
	["plejstejsn 5 disk kao nov", "ps5"],
	["Xbox Series X 1TB", "xbox-series-x"],
	["iksboks series s 512", "xbox-series-s"],
	["Nintendo Switch OLED bela", "switch-oled"],
	["Nintendo svič oled", "switch-oled"],
	["Switch 2 novo", "switch-2"],
	// Sony headphones
	["Sony WH1000XM5 slusalice", "sony-wh-1000xm5"],
	["sony xm5 crne", "sony-wh-1000xm5"],
	["Sony WH-1000XM4 polovne", "sony-wh-1000xm4"],
	// Laptops
	["mekbuk air m2 8/256", "macbook-air-m2"],
	["MacBook Air M3 16GB 512GB", "macbook-air-m3"],
	["Makbuk pro 14 m3 512", "macbook-pro-14-m3"],
	["Lenovo IdeaPad Slim 5 16GB 512GB", "ideapad-slim-5"],
	["viktus 15 rtx", "hp-victus-15"],
	["asus tuf a15 rtx 4060", "asus-tuf-a15"],
	["TUF Gaming A15 Ryzen", "asus-tuf-a15"],
	// Tablets, watch
	["iPad 10 64GB", "ipad-10"],
	["ajped 10 256", "ipad-10"],
	["iPad Air M2 128GB", "ipad-air-m2"],
	["AirPods Pro 2 nove", "airpods-pro-2"],
	["erpods pro 2 kao nov", "airpods-pro-2"],
	["Airpods pro 2nd gen", "airpods-pro-2"],
	["Apple Watch Series 9 45mm", "apple-watch-9"],
	// GPUs
	["RTX4070S 12GB", "rtx-4070-super"],
	["rtx 4070 super novo", "rtx-4070-super"],
	["GeForce RTX 4060 8GB", "rtx-4060"],
	["rx7800xt 16gb", "rx-7800-xt"],
	["Radeon RX 7800 XT", "rx-7800-xt"],
	["LG OLED55C3 4K", "lg-oled55c3"],

	// Negatives: rejected or not in the catalogue. Expected null.
	["maska za iphone 15 pro", null],
	["kutija od iphone 14", null],
	["iphone 13 za delove", null],
	["iCloud lock iPhone 15 Pro", null],
	["replika iphone 15 pro max", null],
	["Kupujem iphone 15", null],
	["tražim PlayStation 5", null],
	["iPhone 15 Pro Max zakljucan", null],
	["PS5 maska silikonska", null],
	["dzojstik za ps5", null],
	["Galaxy S24 Ultra futrola", null],
	["staklo za iphone 15 pro", null],
	["Samsung S24 Ultra ekran razbijen", null],
	["Samsung S24 Ultra ne radi", null],
	["Telefon iphone 15 pro neispravan", null],
	["Galaxy A55 pokvaren ekran", null],
	["iPhone 15 Pro 256", null, "zakljucan icloud"],
	["iPhone 15 128", null, "replika"],
	["Ajfon 14 Pro Max 256", null],
	["iPhone 15 Plus 128GB", null],
	["iPhone 13 mini 128gb", null],
	["Pixel 8a 128", null],
	["Pixel 8 Pro 256gb", null],
	["Galaxy S24 FE 256", null],
	["Samsung S24+ 256GB", null],
	["Xiaomi 13T 256", null],
	["MacBook Pro 16 M3", null],
	["rtx 4060 ti 8gb", null],
	["Nintendo Switch Lite", null],
	["Ps5 slim", null],
	["Sony xm3 slusalice", null],
	["Xiaomi 14 Ultra 512", null],
	["Samsung Galaxy S25 Ultra 512", null],
	["Pixel 9 Pro XL", null],
	["Gaming laptop Asus TUF F15", null],
	["RTX 4070 Ti Super 16GB", null],
	["AirPods Pro 1 generacija", null],
]

// A second batch, written after the first run, so the numbers are not only from the first set.
const HELD_OUT: Array<[string, string | null, string?]> = [
	["Ajfon 16 Pro 128 kao nov", "iphone-16-pro"],
	["Ajfon 13 128gb bela", "iphone-13"],
	["Xbox series x 2 kontrolera", "xbox-series-x"],
	["PS5 + igra + kontroler", "ps5"],
	["Redmi Note 13 Pro 5G 256", "redmi-note-13-pro"],
	["Sony WH-1000XM5 crni NOVO", "sony-wh-1000xm5"],
	["Apple Watch 9 41mm", "apple-watch-9"],
	["Samsung Galaxy A35 nov 256", "galaxy-a35"],
	["Macbook air m2 13 inch 256", "macbook-air-m2"],
	["kupujem ps5 slim digital", null],
	["Iphone 15 Pro Max 256 gb crni nov", "iphone-15-pro-max"],
	["Galaxy S24 Ultra 256gb kao nov", "galaxy-s24-ultra"],
]

describe("matchTitle on labelled titles", () => {
	it("reaches precision >= 0.95 and recall >= 0.9", () => {
		const run = (set: Array<[string, string | null, string?]>) =>
			set.map(([title, expected, description]) => ({ title, expected, got: matchTitle(title, description).productId }))
		const score = (rows: Array<{ title: string; expected: string | null; got: string | null }>) => {
			const predicted = rows.filter((r) => r.got !== null)
			const correct = predicted.filter((r) => r.got === r.expected)
			const positives = rows.filter((r) => r.expected !== null)
			const recalled = positives.filter((r) => r.got === r.expected)
			return { precision: correct.length / predicted.length, recall: recalled.length / positives.length, predicted, correct, positives, recalled }
		}

		const rows = [...run(CASES), ...run(HELD_OUT)]
		const s = score(rows)
		const held = score(run(HELD_OUT))
		for (const r of rows.filter((r) => r.got !== r.expected)) console.log(`  miss: "${r.title}" expected ${r.expected} got ${r.got}`)
		console.log(`titles: ${rows.length} (${s.positives.length} positive, ${rows.length - s.positives.length} negative)`)
		console.log(`precision ${s.precision.toFixed(3)} (${s.correct.length}/${s.predicted.length})`)
		console.log(`recall    ${s.recall.toFixed(3)} (${s.recalled.length}/${s.positives.length})`)
		console.log(`second batch only: precision ${held.precision.toFixed(3)}, recall ${held.recall.toFixed(3)}`)

		assert.ok(s.precision >= 0.95, `precision ${s.precision}`)
		assert.ok(s.recall >= 0.9, `recall ${s.recall}`)
	})

	it("gives a reject reason for accessories, parts, locks, replicas and wanted ads", () => {
		const expected: Array<[string, string]> = [
			["maska za iphone 15 pro", "accessory"],
			["Galaxy S24 Ultra futrola", "accessory"],
			["iphone 13 za delove", "damaged"],
			["Samsung S24 Ultra ekran razbijen", "damaged"],
			["iCloud lock iPhone 15 Pro", "locked"],
			["replika iphone 15 pro max", "replica"],
			["Kupujem iphone 15", "wanted"],
		]
		for (const [title, reason] of expected) {
			const r = matchTitle(title)
			assert.equal(r.productId, null, title)
			assert.equal(r.method, "none", title)
			assert.equal(r.reject, reason, title)
		}
	})

	it("uses fuzzy matching for a one-letter typo, with confidence in 0.7-0.85", () => {
		const r = matchTitle("Iphnoe 15 Pro 256")
		assert.equal(r.productId, "iphone-15-pro")
		assert.equal(r.method, "fuzzy")
		assert.ok(r.confidence >= 0.7 && r.confidence <= 0.85, `confidence ${r.confidence}`)
	})

	it("uses a rule match with confidence 0.95 for an exact name", () => {
		const r = matchTitle("iPhone 15 Pro 256GB")
		assert.equal(r.method, "rule")
		assert.equal(r.confidence, 0.95)
	})

	it("fills storage and condition", () => {
		assert.equal(matchTitle("Samsumg s24 ultra 512gb kao nov").storageGb, 512)
		assert.equal(matchTitle("Samsumg s24 ultra 512gb kao nov").condition, "used")
		assert.equal(matchTitle("iPhone 17 256GB nov").condition, "new")
		assert.equal(matchTitle("Aifon 17 512GB sealed").condition, "sealed")
		assert.equal(matchTitle("mekbuk air m2 8/256").storageGb, 256)
		assert.equal(matchTitle("Ajfon 15 Pro Maks 256").storageGb, 256)
	})
})

describe("normalize and extractStorage", () => {
	it("transliterates Serbian Cyrillic and Latin diacritics", () => {
		assert.equal(normalize("Ајфон 15 Про 256гб"), "ajfon 15 pro 256gb")
		assert.equal(normalize("Čačak Šabac Žarkovo Đorđe"), "cacak sabac zarkovo djordje")
	})

	it("writes storage units as gb and treats 1 TB as 1024gb", () => {
		assert.equal(normalize("256 GB"), "256gb")
		assert.equal(normalize("256g"), "256gb")
		assert.equal(normalize("256 giga"), "256gb")
		assert.equal(normalize("1 TB"), "1024gb")
	})

	it("makes joined and spaced model codes the same", () => {
		assert.equal(normalize("iphone15pro"), "iphone 15 pro")
		assert.equal(normalize("iphone 15 pro"), "iphone 15 pro")
		assert.equal(normalize("s24ultra"), normalize("s24 ultra"))
		assert.equal(normalize("15pro"), normalize("15 pro"))
		assert.equal(normalize("WH-1000XM5"), "wh 1000 xm 5")
	})

	it("reads storage and skips RAM", () => {
		assert.equal(extractStorage("8/256"), 256)
		assert.equal(extractStorage("8GB RAM 256GB"), 256)
		assert.equal(extractStorage("16GB ram"), null)
		assert.equal(extractStorage("1TB"), 1024)
		assert.equal(extractStorage("55\" 4K"), null)
	})

	it("reads condition words", () => {
		assert.equal(detectCondition("iPhone 13 polovan"), "used")
		assert.equal(detectCondition("iPhone 13 nekoriscen"), "sealed")
		assert.equal(detectCondition("iPhone 13 kao nov"), "used")
		assert.equal(detectCondition("iPhone 13"), null)
	})
})

describe("resolveQuery", () => {
	it("resolves a model to exactly one product", () => {
		assert.deepEqual(resolveQuery("iphone 15 pro").productIds, ["iphone-15-pro"])
		assert.deepEqual(resolveQuery("iphone 15").productIds, ["iphone-15"])
		assert.deepEqual(resolveQuery("iphone 15 pro max 256").productIds, ["iphone-15-pro-max"])
	})

	it("resolves a misspelled query", () => {
		assert.deepEqual(resolveQuery("ajfon 15 pro maks").productIds, ["iphone-15-pro-max"])
		assert.deepEqual(resolveQuery("Ајфон 15 Про").productIds, ["iphone-15-pro"])
	})

	it("resolves a brand word to every model in the family", () => {
		const { productIds, category } = resolveQuery("iphone")
		assert.equal(productIds.length, 8)
		assert.ok(productIds.every((id) => id.startsWith("iphone-")))
		assert.equal(category, "phone")
	})

	it("returns a category and no products for a category word", () => {
		assert.deepEqual(resolveQuery("telefon"), { productIds: [], category: "phone", storageGb: null })
	})

	it("reads storage from the query", () => {
		assert.equal(resolveQuery("iPhone 15 pro 256gb").storageGb, 256)
	})
})

describe("expandQuery", () => {
	it("starts with the query as typed and adds the product name, a joined form and a misspelling", () => {
		const out = expandQuery("iphone 15 pro")
		assert.equal(out[0], "iphone 15 pro")
		assert.ok(out.includes("iphone15 pro"), out.join(" | "))
		assert.ok(out.includes("ajfon 15 pro"), out.join(" | "))
	})

	it("returns at most the limit, with no duplicates", () => {
		const out = expandQuery("iphone 15 pro", 4)
		assert.ok(out.length <= 4)
		assert.equal(new Set(out).size, out.length)
	})
})
