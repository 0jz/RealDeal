// Live adapter for gigatron.rs, on only when LIVE_SOURCES includes "gigatron".
//
// Gigatron's robots.txt disallows its own search (?q=) and paging (?page=), but allows
// /proizvod/ and publishes a product sitemap. So we never call their search: the
// sitemap's product URLs carry the product name in the slug, we match search terms
// against those slugs locally, and fetch only the matching product pages, reading
// name, price and stock from the page's schema.org Product JSON-LD.
//
// Terms: Gigatron allows its content for personal, non-commercial use only. This is
// for the local research prototype; ask Gigatron before using it in anything public.

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import type { RawListing, SearchPage, SourceAdapter } from "../search/types"
import { normalize } from "./fixture"
import { politeFetch } from "./http"

const ORIGIN = "https://gigatron.rs"
const INDEX_FILE = resolve(process.cwd(), "data/cache/gigatron-index.json")
const INDEX_TTL_MS = 24 * 60 * 60 * 1000
const PAGE_SIZE = 4

type Entry = { url: string; tokens: string[] }

/** "apple-iphone-15-pro-128gb-0194253401193" -> ["apple","iphone","15","pro","128gb"] (the trailing EAN/SKU dropped). */
export function slugTokens(url: string): string[] {
	const slug = url.split("/proizvod/")[1] ?? ""
	const parts = slug.toLowerCase().split("-").filter(Boolean)
	if (parts.length > 1 && /^\d{6,}$/.test(parts[parts.length - 1]!)) parts.pop()
	return parts
}

/** Slug words that mark an accessory ("zastitna maska za iphone 15 pro"). Skipped before fetching, to save requests. */
const ACCESSORY = /^(zastit|mask|futrol|stakl|folij|punjac|kabl|adapter|drzac|nosac|postolje|dock|station|hub|daljinski|remote|torb|silikon|narukvic|remen)/

/** Every word of the term starts some slug token ("pro" hits "pro", "15" never hits an EAN), and it isn't an accessory. */
export function slugMatches(tokens: string[], term: string): boolean {
	const words = normalize(term).split(/[\s-]+/).filter(Boolean)
	return words.length > 0 && words.every((w) => tokens.some((t) => t.startsWith(w))) && !tokens.some((t) => ACCESSORY.test(t))
}

type Offer = { price?: number | string; availability?: string; url?: string }
type ProductLd = { "@type"?: string; name?: string; sku?: string; productID?: string; offers?: Offer | Offer[] }

/** Reads the schema.org Product block of a product page. null when absent, unpriced or out of stock. */
export function parseProduct(html: string, url: string): RawListing | null {
	for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
		let d: ProductLd
		try {
			d = JSON.parse(m[1]!) as ProductLd
		} catch {
			continue
		}
		if (d["@type"] !== "Product" || !d.name) continue
		const offer = Array.isArray(d.offers) ? d.offers[0] : d.offers
		const price = Number(offer?.price)
		if (!offer || !Number.isFinite(price) || price <= 0) return null
		if (offer.availability && !/InStock|LimitedAvailability|PreOrder/.test(offer.availability)) return null
		return {
			source: "gigatron",
			id: String(d.productID ?? d.sku ?? url),
			url,
			title: d.name,
			description: null,
			price: Math.round(price),
			shipping: null,
			condition: "new",
			city: null,
			seller: null,
			shopId: "gigatron",
			shopName: "Gigatron",
		}
	}
	return null
}

const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!.trim())

async function buildIndex(): Promise<string[]> {
	const urls: string[] = []
	for (const sitemap of locs(await politeFetch(`${ORIGIN}/sitemap/proizvodi.xml`))) {
		urls.push(...locs(await politeFetch(sitemap)).filter((u) => u.includes("/proizvod/")))
	}
	return urls
}

/** Product URLs from the sitemap, cached on disk for a day (building it is ~45 polite requests). */
async function loadIndex(): Promise<Entry[]> {
	let urls: string[] | null = null
	try {
		const saved = JSON.parse(await readFile(INDEX_FILE, "utf8")) as { at: number; urls: string[] }
		if (Date.now() - saved.at < INDEX_TTL_MS) urls = saved.urls
	} catch {
		// no cache yet
	}
	if (!urls) {
		urls = await buildIndex()
		await mkdir(dirname(INDEX_FILE), { recursive: true })
		await writeFile(INDEX_FILE, JSON.stringify({ at: Date.now(), urls }))
	}
	return urls.map((url) => ({ url, tokens: slugTokens(url) }))
}

export function createGigatronAdapter(): SourceAdapter {
	let index: Promise<Entry[]> | null = null
	const getIndex = () => {
		index ??= loadIndex()
		index.catch(() => (index = null)) // retry on the next search
		return index
	}
	void getIndex().catch((err) => console.error("[gigatron] index:", err instanceof Error ? err.message : err))

	return {
		id: "gigatron",
		name: "Gigatron",
		kind: "shop",
		live: true,

		async search(term: string, page: number): Promise<SearchPage> {
			const hits = (await getIndex()).filter((e) => slugMatches(e.tokens, term))
			const start = (Math.max(1, page) - 1) * PAGE_SIZE
			const listings: RawListing[] = []
			for (const e of hits.slice(start, start + PAGE_SIZE)) {
				const listing = await politeFetch(e.url).then((html) => parseProduct(html, e.url)).catch(() => null)
				if (listing) listings.push(listing)
			}
			return { listings, hasMore: start + PAGE_SIZE < hits.length }
		},
	}
}
