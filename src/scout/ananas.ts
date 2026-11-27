// Ananas scout. Only the HTML search and product pages: robots.txt disallows
// /api/, /app2/api/, /en/ and /sr/. Price, picture and link come from one page.

import { politeFetch } from "../sources/http"
import type { ScoutCandidate, ShopScout } from "./types"
import { ScoutBlocked } from "./types"

const ORIGIN = "https://ananas.rs"
const CHALLENGE = /cf-mitigated|cf-browser-verification|cf_chl_|challenge-platform|Attention Required!|Just a moment\.\.\.|checking your browser/i

type FetchPage = (url: string) => Promise<string>

async function getHtml(fetchPage: FetchPage, url: string): Promise<string> {
	let html: string
	try {
		html = await fetchPage(url)
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		if (/HTTP 403|cf-mitigated/i.test(message)) throw new ScoutBlocked(`Ananas blocked the request: ${message}`)
		throw err
	}
	if (CHALLENGE.test(html)) throw new ScoutBlocked(`Ananas blocked the request: challenge page for ${url}`)
	return html
}

/** Unique product URLs from the server-rendered ais-Hits list, in page order. */
export function parseAnanasSearch(html: string): string[] {
	const urls: string[] = []
	const seen = new Set<string>()
	const items = html.split(/<li\b[^>]*\bclass=["'][^"']*\bais-Hits-item\b[^"']*["'][^>]*>/i).slice(1)
	for (const item of items) {
		const end = item.indexOf("</li>")
		const block = end < 0 ? item : item.slice(0, end)
		const href = block.match(/<a\b[^>]*\bhref=["'](\/proizvod\/[^"']+)["']/i)?.[1]
		if (!href) continue
		const url = new URL(href, ORIGIN).href
		if (seen.has(url)) continue
		seen.add(url)
		urls.push(url)
	}
	return urls
}

type ImageLd = string | { url?: string }
type ShippingRate = { value?: number | string; price?: number | string; priceCurrency?: string }
type Shipping = ShippingRate & { shippingRate?: ShippingRate }
type Seller = { name?: string }
type Offer = {
	price?: number | string
	priceCurrency?: string
	availability?: string
	seller?: Seller
	shippingRate?: ShippingRate
	shipping?: Shipping | Shipping[]
}
type ProductLd = {
	"@type"?: string | string[]
	name?: string
	image?: ImageLd | ImageLd[]
	offers?: Offer | Offer[]
}

function ldObjects(value: unknown): Record<string, unknown>[] {
	if (Array.isArray(value)) return value.flatMap(ldObjects)
	if (!value || typeof value !== "object") return []
	const object = value as Record<string, unknown>
	const graph = Array.isArray(object["@graph"]) ? ldObjects(object["@graph"]) : []
	return [object, ...graph]
}

/** The JSON-LD Product block, skipping BreadcrumbList and other typed scripts. */
function productLd(html: string): ProductLd | null {
	for (const script of html.matchAll(/<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
		let data: unknown
		try {
			data = JSON.parse(script[1]!)
		} catch {
			continue
		}
		for (const object of ldObjects(data)) {
			const type = object["@type"]
			if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) return object as unknown as ProductLd
		}
	}
	return null
}

/** Number from JSON-LD, accepting "2.599" and "2.599,00" alongside plain values. */
function number(value: number | string | undefined): number | null {
	if (typeof value !== "number" && typeof value !== "string") return null
	let text = String(value).trim().replace(/[\s ]/g, "").replace(/RSD/gi, "")
	if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) text = text.replace(/\./g, "").replace(",", ".")
	else if (/^\d+,\d+$/.test(text)) text = text.replace(",", ".")
	const result = Number(text)
	return Number.isFinite(result) ? result : null
}

function price(offer: Offer): number | null {
	if (String(offer.priceCurrency).toUpperCase() !== "RSD") return null
	const value = number(offer.price)
	return value !== null && value > 0 ? Math.round(value) : null
}

function firstImage(image: ProductLd["image"]): string | null {
	const list = Array.isArray(image) ? image : [image]
	for (const entry of list) {
		const url = typeof entry === "string" ? entry : entry?.url
		if (typeof url === "string" && url.startsWith("https://")) return url
	}
	return null
}

function ogImage(html: string): string | null {
	const tag = html.match(/<meta\b[^>]*\bproperty=["']og:image["'][^>]*>/i)?.[0]
	const url = tag?.match(/\bcontent=["']([^"']+)["']/i)?.[1]
	return url?.startsWith("https://") ? url : null
}

/** Delivery only when the JSON-LD actually carries a numeric shipping rate. */
function shippingRate(offer: Offer): number | null {
	const rates: ShippingRate[] = [offer.shippingRate ?? {}]
	const shipping = Array.isArray(offer.shipping) ? offer.shipping : [offer.shipping]
	for (const entry of shipping) {
		if (!entry || typeof entry !== "object") continue
		if (entry.shippingRate) rates.unshift(entry.shippingRate)
		rates.push(entry)
	}
	for (const rate of rates) {
		if (rate.priceCurrency && String(rate.priceCurrency).toUpperCase() !== "RSD") continue
		const value = number(rate.value ?? rate.price)
		if (value !== null && value >= 0) return value
	}
	return null
}

/** Only a named seller on the page counts; no guessing from the brand or URL. */
function seller(html: string, offer: Offer): string | null {
	if (typeof offer.seller?.name === "string" && offer.seller.name.trim()) return offer.seller.name.trim()
	const tag = html.match(/<a\b[^>]*\bdata-testid=["']product-merchant-title["'][^>]*>([^<]+)<\/a>/i)?.[1]
	return tag?.trim() || null
}

export function parseAnanasProduct(html: string, url: string, now: string): ScoutCandidate | null {
	const product = productLd(html)
	if (!product || typeof product.name !== "string" || !product.name.trim()) return null
	const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers
	const amount = offer ? price(offer) : null
	if (!offer || amount === null) return null

	const name = seller(html, offer)
	const availability = offer.availability
	return {
		site: "ananas",
		shop: name && name.toLowerCase() !== "ananas" ? `Ananas · ${name}` : "Ananas",
		title: product.name.trim(),
		price: amount,
		delivery: shippingRate(offer),
		inStock: typeof availability === "string" ? /InStock|LimitedAvailability|PreOrder/i.test(availability) : null,
		url,
		image: firstImage(product.image) ?? ogImage(html),
		checkedAt: now,
	}
}

export function createAnanasScout(fetchPage: FetchPage = politeFetch): ShopScout {
	return {
		site: "ananas",
		// No price filters in the URL: the ranker applies the range to real prices later.
		async search(query: string, _range?: Parameters<ShopScout["search"]>[1]): Promise<string[]> {
			const url = `${ORIGIN}/search?query=${encodeURIComponent(query)}`
			return parseAnanasSearch(await getHtml(fetchPage, url))
		},
		async read(url: string): Promise<ScoutCandidate | null> {
			return parseAnanasProduct(await getHtml(fetchPage, url), url, new Date().toISOString())
		},
	}
}
