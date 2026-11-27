import { pickCategory } from "../sources/categories"
import { customerFetch } from "../sources/customer"
import { filterCards, parseEponudaCards } from "../sources/eponuda"
import type { ScoutCandidate, ShopScout } from "./types"

type FetchPage = (url: string, opts?: { fresh?: boolean }) => Promise<string | null>
type ImageLd = string | { url?: string }
type OfferLd = { lowPrice?: number | string; offerCount?: number | string; availability?: string }
type ProductLd = { "@type"?: string | string[]; name?: string; image?: ImageLd | ImageLd[]; offers?: OfferLd | OfferLd[] }

const ORIGIN = "https://www.eponuda.com"
const MAX_RESULTS = 8

function ldObjects(value: unknown): Record<string, unknown>[] {
	if (Array.isArray(value)) return value.flatMap(ldObjects)
	if (!value || typeof value !== "object") return []
	const object = value as Record<string, unknown>
	const graph = Array.isArray(object["@graph"]) ? ldObjects(object["@graph"]) : []
	return [object, ...graph]
}

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

function positive(value: unknown): number | null {
	const number = typeof value === "string" ? Number(value.replace(/[\s ]/g, "")) : value
	return typeof number === "number" && Number.isFinite(number) && number > 0 ? number : null
}

function firstImage(image: ProductLd["image"]): string | null {
	const list = Array.isArray(image) ? image : [image]
	for (const entry of list) {
		const url = typeof entry === "string" ? entry : entry?.url
		if (typeof url === "string" && url.startsWith("https://")) return url
	}
	return null
}

function inStock(availability: unknown): boolean | null {
	if (typeof availability !== "string") return null
	if (/InStock|LimitedAvailability/i.test(availability)) return true
	if (/OutOfStock/i.test(availability)) return false
	return null
}

export function parseEponudaProduct(html: string, url: string, now: string): ScoutCandidate | null {
	const product = productLd(html)
	if (!product || typeof product.name !== "string" || !product.name.trim()) return null
	const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers
	const lowPrice = offer ? positive(offer.lowPrice) : null
	if (lowPrice === null) return null
	const count = offer ? positive(offer.offerCount) : null
	return {
		site: "eponuda",
		shop: count === null ? "eponuda" : `eponuda · ${Math.round(count)} prodavnica`,
		title: product.name.trim(),
		price: Math.round(lowPrice),
		delivery: null,
		inStock: offer ? inStock(offer.availability) : null,
		url,
		image: firstImage(product.image),
		checkedAt: now,
	}
}

export function createEponudaScout(fetchPage: FetchPage = customerFetch): ShopScout {
	return {
		site: "eponuda",
		async search(query: string, _range?: Parameters<ShopScout["search"]>[1]): Promise<string[]> {
			const category = pickCategory(query)
			if (!category) return []
			const html = await fetchPage(`${ORIGIN}/${category.eponuda}`)
			if (!html) return []
			const seen = new Set<string>()
			const urls: string[] = []
			for (const card of filterCards(parseEponudaCards(html), query)) {
				if (!/-cena-\d+$/.test(card.url) || seen.has(card.url)) continue
				seen.add(card.url)
				urls.push(card.url)
				if (urls.length >= MAX_RESULTS) break
			}
			return urls
		},
		async read(url: string): Promise<ScoutCandidate | null> {
			const html = await fetchPage(url)
			return html ? parseEponudaProduct(html, url, new Date().toISOString()) : null
		},
	}
}
