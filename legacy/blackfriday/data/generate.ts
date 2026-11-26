import type { Dataset, KpListing, Offer, Pattern, Shop, Sku } from "./types"

// All data is synthetic. Shop names are invented and describe no real retailer.

/** mulberry32: small seeded PRNG so every run with the same seed is identical. */
function rng(seed: number) {
	let a = seed >>> 0
	const next = () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
	return {
		next,
		between: (lo: number, hi: number) => lo + next() * (hi - lo),
		int: (lo: number, hi: number) => Math.floor(lo + next() * (hi - lo + 1)),
		pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)],
	}
}

/** Round to a shelf price ending in 99 RSD. */
const shelf = (x: number) => Math.max(99, Math.round(x / 100) * 100 - 1)

const SHOPS: Shop[] = [
	{ id: "tehnomarket", name: "TehnoMarket" },
	{ id: "gigabit", name: "Gigabit" },
	{ id: "elektroplus", name: "ElektroPlus" },
	{ id: "digimax", name: "DigiMax" },
	{ id: "voltshop", name: "VoltShop" },
]

/** How likely each shop is to plant a fake discount. DigiMax is the one that gets caught. */
const DISHONESTY: Record<string, number> = {
	tehnomarket: 0.15,
	gigabit: 0.2,
	elektroplus: 0.1,
	digimax: 0.7,
	voltshop: 0.25,
}

const CATALOG: Array<[category: string, name: string, base: number]> = [
	["phone", "Samsung Galaxy S25 128GB", 104_999],
	["phone", "Samsung Galaxy A56 256GB", 49_999],
	["phone", "Apple iPhone 16 128GB", 129_999],
	["phone", "Apple iPhone 15 128GB", 99_999],
	["phone", "Xiaomi Redmi Note 14 Pro", 39_999],
	["phone", "Google Pixel 9a", 59_999],
	["phone", "Motorola Edge 50", 44_999],
	["phone", "Honor 200 Lite", 27_999],
	["laptop", "Lenovo IdeaPad Slim 5 14", 89_999],
	["laptop", "ASUS Vivobook 15 OLED", 74_999],
	["laptop", "Apple MacBook Air 13 M3", 159_999],
	["laptop", "HP Pavilion 15", 69_999],
	["laptop", "Acer Nitro V 15", 109_999],
	["laptop", "Dell Inspiron 14", 84_999],
	["laptop", "Lenovo Legion 5", 179_999],
	["console", "Sony PlayStation 5 Slim", 64_999],
	["console", "Xbox Series X", 62_999],
	["console", "Nintendo Switch OLED", 41_999],
	["console", "Xbox Series S", 34_999],
	["console", "Steam Deck OLED 512GB", 74_999],
	["tv", "Samsung 55\" Crystal UHD", 59_999],
	["tv", "LG 55\" OLED C4", 159_999],
	["tv", "Sony Bravia 50\" X75", 74_999],
	["tv", "TCL 65\" QLED", 79_999],
	["tv", "Philips 43\" Ambilight", 44_999],
	["tv", "Hisense 50\" 4K", 39_999],
	["headphones", "Sony WH-1000XM5", 44_999],
	["headphones", "Apple AirPods Pro 2", 32_999],
	["headphones", "JBL Tune 770NC", 11_999],
	["headphones", "Samsung Galaxy Buds3 Pro", 27_999],
	["headphones", "Bose QuietComfort Ultra", 54_999],
	["headphones", "Sennheiser Momentum 4", 39_999],
	["tablet", "Apple iPad 10.9 64GB", 54_999],
	["tablet", "Samsung Galaxy Tab S9 FE", 49_999],
	["watch", "Apple Watch Series 10", 54_999],
	["watch", "Samsung Galaxy Watch 7", 34_999],
	["watch", "Garmin Forerunner 265", 49_999],
	["camera", "GoPro HERO13 Black", 54_999],
	["speaker", "JBL Charge 5", 17_999],
	["speaker", "Marshall Emberton II", 19_999],
]

const CITIES = ["Beograd", "Novi Sad", "Niš", "Kragujevac", "Subotica", "Čačak"]

const DAYS = 60

function makeOffer(r: ReturnType<typeof rng>, shop: Shop, sku: Sku, pattern: Pattern): Offer {
	const base = sku.basePrice * r.between(0.94, 1.06)
	const noisy = () => shelf(base * r.between(0.985, 1.015))
	const history: (number | null)[] = Array.from({ length: DAYS }, noisy)
	const min30 = () => Math.min(...(history.slice(DAYS - 30).filter((p) => p !== null) as number[]))

	switch (pattern) {
		case "honest": {
			const bf = shelf(min30() * r.between(0.75, 0.88))
			return { shopId: shop.id, skuId: sku.id, pattern, history, bfPrice: bf, shownPrevPrice: min30() }
		}
		case "presale-hike": {
			// Hike ~40% in the last 12–20 days, then advertise "-40%" off the hiked price.
			const hikeFrom = DAYS - r.int(12, 20)
			const hiked = shelf(base * r.between(1.35, 1.5))
			for (let d = hikeFrom; d < DAYS; d++) history[d] = hiked
			return { shopId: shop.id, skuId: sku.id, pattern, history, bfPrice: shelf(hiked * 0.6), shownPrevPrice: hiked }
		}
		case "inflated-prev": {
			const shown = shelf(base * r.between(1.4, 1.6))
			return { shopId: shop.id, skuId: sku.id, pattern, history, bfPrice: shelf(min30() * 0.97), shownPrevPrice: shown }
		}
		case "new-item": {
			// In stock for only 18–25 days: shown price must be the lowest of the last 15 days.
			const listed = DAYS - r.int(18, 25)
			for (let d = 0; d < listed; d++) history[d] = null
			const min15 = Math.min(...(history.slice(DAYS - 15) as number[]))
			return { shopId: shop.id, skuId: sku.id, pattern, history, bfPrice: shelf(min15 * 0.85), shownPrevPrice: min15 }
		}
		case "tiny": {
			const prev = min30()
			return { shopId: shop.id, skuId: sku.id, pattern, history, bfPrice: prev - r.int(1, 9) * 10, shownPrevPrice: prev }
		}
		case "no-sale": {
			const p = history[DAYS - 1] as number
			return { shopId: shop.id, skuId: sku.id, pattern, history, bfPrice: p, shownPrevPrice: p }
		}
	}
}

function pickPattern(r: ReturnType<typeof rng>, shopId: string): Pattern {
	if (r.next() < DISHONESTY[shopId]) return r.pick(["presale-hike", "presale-hike", "inflated-prev", "tiny"] as const)
	return r.pick(["honest", "honest", "honest", "new-item", "no-sale"] as const)
}

export function generate(seed = 2611): Dataset {
	const r = rng(seed)

	const skus: Sku[] = CATALOG.map(([category, name, base], i) => ({
		id: `sku-${String(i + 1).padStart(2, "0")}`,
		name,
		category,
		basePrice: base,
	}))

	const offers: Offer[] = []
	for (const sku of skus) {
		// Each SKU is sold by 3–5 shops.
		const sellers = [...SHOPS].sort(() => r.next() - 0.5).slice(0, r.int(3, 5))
		for (const shop of sellers) offers.push(makeOffer(r, shop, sku, pickPattern(r, shop.id)))
	}

	const kp: KpListing[] = []
	let n = 0
	for (const sku of skus) {
		if (r.next() < 0.35) continue // not every model is on KP
		const cheapestShop = Math.min(...offers.filter((o) => o.skuId === sku.id).map((o) => o.bfPrice))
		for (let i = r.int(1, 4); i > 0; i--) {
			const sealed = r.next() < 0.4
			// About 1 in 4 sealed listings undercuts every shop: the "buy on KP instead" case.
			const factor = sealed ? (r.next() < 0.25 ? r.between(0.8, 0.9) : r.between(0.95, 1.1)) : r.between(0.55, 0.8)
			kp.push({
				id: `kp-${String(++n).padStart(3, "0")}`,
				skuId: sku.id,
				title: `${sku.name}${sealed ? " — NOVO, zapakovano" : " — korišćen, ispravan"}`,
				price: shelf(cheapestShop * factor),
				condition: sealed ? "new-sealed" : "used",
				city: r.pick(CITIES),
			})
		}
	}

	return { seed, shops: SHOPS, skus, offers, kp }
}
