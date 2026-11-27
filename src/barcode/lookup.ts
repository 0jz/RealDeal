import { barcodeKey, normalizeBarcode, type BarcodeProduct, type BarcodeResult } from "./code"

const HEADERS = { "User-Agent": "RealDeal/0.1 (https://github.com/0jz/RealDeal)", Accept: "application/json" }
type FetchJson = (url: string) => Promise<unknown>
const fetchJson: FetchJson = async url => {
	const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) })
	// Open Food Facts may send a structured "not found" body with HTTP 404.
	if (!response.ok && response.status !== 404) throw new Error(`Barcode provider HTTP ${response.status}`)
	return response.json()
}

const record = (x: unknown): Record<string, unknown> => x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : {}
const text = (x: unknown, max = 300): string | null => typeof x === "string" ? x.trim().slice(0, max) || null : null
const image = (x: unknown): string | null => {
	if (typeof x !== "string") return null
	try { const u = new URL(x); return u.protocol === "https:" && !u.username && !u.password ? u.href : null } catch { return null }
}
const matches = (expected: string, actual: unknown) => {
	const normalized = normalizeBarcode(actual)
	return normalized !== null && barcodeKey(normalized) === barcodeKey(expected)
}

export function parseUpcItemDb(data: unknown, code: string): BarcodeProduct | null {
	const root = record(data)
	if (root.code !== "OK" || !Array.isArray(root.items)) throw new Error("Invalid UPCitemdb response")
	for (const value of root.items) {
		const item = record(value)
		if (![item.ean, item.upc, item.gtin].some(id => matches(code, id))) continue
		const title = text(item.title)
		if (!title) continue
		return { barcode: code, title, brand: text(item.brand), category: text(item.category),
			image: Array.isArray(item.images) ? item.images.map(image).find(Boolean) ?? null : null,
			source: { name: "UPCitemdb", url: `https://www.upcitemdb.com/upc/${code}` } }
	}
	return null
}

export function parseOpenFoodFacts(data: unknown, code: string): BarcodeProduct | null {
	const root = record(data)
	if (root.status === 0) return null
	if (root.status !== 1) throw new Error("Invalid Open Food Facts response")
	const item = record(root.product)
	if (!matches(code, item.code ?? root.code)) return null
	const title = text(item.product_name)
	if (!title) return null
	return { barcode: code, title, brand: text(item.brands), category: text(item.categories), image: image(item.image_front_small_url),
		source: { name: "Open Food Facts", url: `https://world.openfoodfacts.org/product/${code}` } }
}

/** A small bounded cache and in-flight deduplication avoid repeated provider calls. */
export function createBarcodeLookup(get: FetchJson = fetchJson, now = Date.now) {
	const cache = new Map<string, { until: number; result: BarcodeResult }>()
	const pending = new Map<string, Promise<BarcodeResult>>()
	return async (input: unknown): Promise<BarcodeResult> => {
		const code = normalizeBarcode(input)
		if (!code) throw new Error("Enter a valid EAN-8, UPC-A, EAN-13 or GTIN-14 barcode, including its check digit.")
		const key = barcodeKey(code)
		const saved = cache.get(key)
		if (saved && saved.until > now()) return saved.result
		const current = pending.get(key)
		if (current) return current
		if (pending.size >= 8) return { status: "unavailable", barcode: code, message: "Barcode lookup is busy. Please try again shortly." }
		const work = (async (): Promise<BarcodeResult> => {
			let failed = false
			const providers = [
				{ url: `https://api.upcitemdb.com/prod/trial/lookup?upc=${code}`, parse: parseUpcItemDb },
				{ url: `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=code,product_name,brands,categories,image_front_small_url`, parse: parseOpenFoodFacts },
			]
			for (const provider of providers) {
				try {
					const product = provider.parse(await get(provider.url), code)
					if (product) return { status: "found", product }
				} catch { failed = true }
			}
			return failed
				? { status: "unavailable", barcode: code, message: "A barcode database is unavailable or its request limit was reached. Please try again later." }
				: { status: "not_found", barcode: code, message: "This barcode was read, but no matching product was found in the connected databases. You can enter the product name yourself." }
		})()
		pending.set(key, work)
		try {
			const result = await work
			if (result.status !== "unavailable") {
				if (cache.size >= 500) cache.delete(cache.keys().next().value!)
				cache.set(key, { until: now() + (result.status === "found" ? 3_600_000 : 120_000), result })
			}
			return result
		} finally { pending.delete(key) }
	}
}

export const lookupBarcode = createBarcodeLookup()
