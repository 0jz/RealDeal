import { pickCategory } from "../sources/categories"
import { BRAND_TOKENS, filterTiles, parseCenotekaOffers, parseCenotekaTiles, type Offer, type Tile } from "../sources/cenoteka"
import { customerFetch, isBackedOff } from "../sources/customer"
import { ScoutBlocked, type ScoutCandidate, type ShopScout } from "./types"

type FetchPage = (url: string, opts?: { fresh?: boolean }) => Promise<string | null>

const ORIGIN = "https://cenoteka.rs"
const MAX_RESULTS = 8

/** customerFetch returns null both for a missing page and for a challenge; only the challenge (host in cool-down) is a block. */
async function fetchOrBlocked(fetchPage: FetchPage, url: string): Promise<string | null> {
	const html = await fetchPage(url)
	if (html === null && isBackedOff(url)) throw new ScoutBlocked(`Cenoteka blocked the request: challenge for ${url}`)
	return html
}

function metaContent(html: string, property: string): string | null {
	const tag = html.match(new RegExp(`<meta\\b[^>]*\\bproperty=["']${property}["'][^>]*>`, "i"))?.[0]
	return tag?.match(/\bcontent=["']([^"']+)["']/i)?.[1]?.trim() || null
}

function httpsImage(html: string): string | null {
	const url = metaContent(html, "og:image")
	return url?.startsWith("https://") ? url : null
}

function cheapest(offers: Offer[]): Offer {
	let best = offers[0]!
	for (const offer of offers) if (offer.price < best.price) best = offer
	return best
}

export function parseCenotekaProduct(html: string, url: string, now: string): ScoutCandidate | null {
	const offers = parseCenotekaOffers(html, url)
	if (!offers.length) return null
	const offer = cheapest(offers)
	return {
		site: "cenoteka",
		shop: `Cenoteka · ${offer.shopName ?? "shop"}`,
		title: metaContent(html, "og:title") ?? "",
		price: offer.price,
		delivery: null,
		inStock: true,
		url,
		image: httpsImage(html),
		checkedAt: now,
	}
}

export function createCenotekaScout(fetchPage: FetchPage = customerFetch): ShopScout {
	return {
		site: "cenoteka",
		async search(query: string, _range?: Parameters<ShopScout["search"]>[1]): Promise<string[]> {
			const category = pickCategory(query)
			if (!category) return []
			const brand = BRAND_TOKENS.find(([re]) => category.words.some((w) => re.test(w)))
			const paths = brand ? [`/b/${brand[1]}/${category.cenoteka}/`, `/${category.cenoteka}/`] : [`/${category.cenoteka}/`]
			let tiles: Tile[] = []
			for (const path of paths) {
				const html = await fetchOrBlocked(fetchPage, `${ORIGIN}${path}`)
				if (!html) continue
				tiles = parseCenotekaTiles(html)
				if (tiles.length) break
			}
			const seen = new Set<string>()
			const urls: string[] = []
			for (const tile of filterTiles(tiles, query)) {
				const url = `${ORIGIN}/p/${tile.slug}/`
				if (seen.has(url)) continue
				seen.add(url)
				urls.push(url)
				if (urls.length >= MAX_RESULTS) break
			}
			return urls
		},
		async read(url: string): Promise<ScoutCandidate | null> {
			const html = await fetchOrBlocked(fetchPage, url)
			return html ? parseCenotekaProduct(html, url, new Date().toISOString()) : null
		},
	}
}
