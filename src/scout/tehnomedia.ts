// Tehnomedia scout: the shop's own search page and Product JSON-LD in @graph.
// Fetching goes through politeFetch by default; tests inject a stub.

import { pageCategory } from "./category"
import { judgeOffline } from "./judge"
import { inRange, MIN_SCORE } from "./rank"
import { politeFetch } from "../sources/http"
import { ScoutBlocked, type ScoutCandidate, type ShopScout } from "./types"

const ORIGIN = "https://www.tehnomedia.rs"
const SEARCH = `${ORIGIN}/search/find.html`
const PREFIX = `${ORIGIN}/proizvod/`
const CHALLENGE = /cf-challenge|cf-browser-verification|__cf_chl_|challenge-platform|just a moment\.\.\.|attention required!/i

type Loose = Record<string, unknown>

const asRecord = (v: unknown): Loose | null => typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Loose) : null

async function get(fetchPage: (url: string) => Promise<string>, url: string): Promise<string> {
	let html: string
	try {
		html = await fetchPage(url)
	} catch (err) {
		if (err instanceof Error && /\b403\b|cf-mitigated|blocked by robots/i.test(err.message)) throw new ScoutBlocked(`Tehnomedia blocked ${url}`)
		throw err
	}
	if (CHALLENGE.test(html)) throw new ScoutBlocked(`Tehnomedia blocked ${url}`)
	return html
}

/** Product URLs from result cards, unique and in page order. */
export function parseTehnomediaSearch(html: string, range: { minPrice?: number; maxPrice?: number } = {}, query?: string): string[] {
	const urls: string[] = []
	const seen = new Set<string>()
	const cards = /<article\b[^>]*\bclass\s*=\s*["'][^"']*\btm-product-single\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi
	for (const card of html.matchAll(cards)) {
		const title = card[1]!.match(/<a\b[^>]*class=["']product-link["'][^>]*>([\s\S]*?)<\/a>/i)?.[1]?.replace(/<[^>]+>/g, "").trim()
		const category = card[1]!.match(/class=["']product-category["'][^>]*>([^<]+)/i)?.[1]?.trim()
		if (query && title && judgeOffline({ wantText: query, query, attributes: [] }, { title, category }).score < MIN_SCORE) continue
		const amount = card[1]!.match(/class=["']tm-product-price["'][^>]*>([\d.,\s]+)/i)?.[1]
		const hint = amount ? Number(amount.replace(/[.\s]/g, "").replace(",", ".")) : null
		if (hint !== null && Number.isFinite(hint) && !inRange(hint, range)) continue
		for (const a of card[1]!.matchAll(/<a\b[^>]*>/gi)) {
			if (!/\bclass\s*=\s*["'][^"']*\bproduct-link\b/i.test(a[0])) continue
			const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(a[0])?.[1]
			if (!href?.startsWith(PREFIX) || seen.has(href)) continue
			seen.add(href)
			urls.push(href)
		}
	}
	return urls
}

function findProduct(data: unknown): Loose | null {
	const root = asRecord(data)
	if (!root) return null
	const graph = Array.isArray(root["@graph"]) ? root["@graph"] : [root]
	return graph.map(asRecord).find((x) => {
		const type = x?.["@type"]
		return type === "Product" || (Array.isArray(type) && type.includes("Product"))
	}) ?? null
}

function firstImage(value: unknown): string | null {
	for (const item of Array.isArray(value) ? value : [value]) {
		const url = typeof item === "string" ? item : asRecord(item)?.url
		if (typeof url === "string" && url.startsWith("https://")) return url
	}
	return null
}

function inStock(availability: unknown): boolean | null {
	const text = typeof availability === "string" ? availability : ""
	if (/instock/i.test(text)) return true
	if (/outofstock/i.test(text)) return false
	return null
}

function delivery(offer: Loose | null): number | null {
	const rate = asRecord(asRecord(offer?.shippingDetails)?.shippingRate)
	const value = rate?.value
	return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** Reads one product page. null when it has no Product JSON-LD or no clean price. */
export function parseTehnomediaProduct(html: string, url: string, now: string): ScoutCandidate | null {
	for (const m of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
		let data: unknown
		try {
			data = JSON.parse(m[1]!)
		} catch {
			continue
		}
		const product = findProduct(data)
		if (!product) continue
		const offer = Array.isArray(product.offers) ? asRecord(product.offers[0]) : asRecord(product.offers)
		const price = Number(offer?.price)
		if (!offer || !Number.isFinite(price) || price <= 0) return null
		return {
			site: "tehnomedia",
			shop: "Tehnomedia",
			title: String(product.name ?? "").trim(),
			category: pageCategory(html),
			price: Math.round(price),
			delivery: delivery(offer),
			inStock: inStock(offer.availability),
			url,
			image: firstImage(product.image),
			checkedAt: now,
		}
	}
	return null
}

function searchUrl(query: string, range: { minPrice?: number; maxPrice?: number }): string {
	let url = `${SEARCH}?rec=${encodeURIComponent(query)}`
	if (range.minPrice !== undefined) url += `&priceFrom=${encodeURIComponent(String(range.minPrice))}`
	if (range.maxPrice !== undefined) url += `&priceTo=${encodeURIComponent(String(range.maxPrice))}`
	return url
}

export function createTehnomediaScout(fetchPage: (url: string) => Promise<string> = politeFetch): ShopScout {
	return {
		site: "tehnomedia",
		supportsPriceRange: true,
		async search(query, range) {
			return parseTehnomediaSearch(await get(fetchPage, searchUrl(query, range)), range, query)
		},
		async read(url) {
			return parseTehnomediaProduct(await get(fetchPage, url), url, new Date().toISOString())
		},
	}
}
