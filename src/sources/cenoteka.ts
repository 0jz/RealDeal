// Live adapter for Cenoteka (cenoteka.rs), on only when LIVE_SOURCES includes "cenoteka".
//
// Cenoteka is a price comparison site behind Cloudflare (see customer.ts for
// the customer profile and the rate-limit measurements). robots.txt allows
// everything except /_next/data/*.json, /redirect/ and /offline/:
//   - search results are client-rendered, so we never call /pretraga;
//   - instead we read the server-rendered category pages (18 popular product
//     tiles each) and filter tiles locally by the search term;
//   - we never fetch /redirect/ — the shop link is decoded from its
//     `redirect_url` query parameter, and offers are read from the product
//     page's OfferList (shop, price, link per offer).
// One search costs at most 1 category page + up to 4 product pages, all
// served from the 10-minute polite cache for repeated terms.
//
// Cenoteka is mostly groceries; the electronics slice is thin, so a category
// page's 18 tiles may not cover every old model. Empty results here are normal.

import { customerFetch } from "./customer"
import { isAccessoryName, nameMatches, pickCategory, requiredWords } from "./categories"
import { normalize } from "./fixture"
import type { RawListing, SearchPage, SourceAdapter } from "../search/types"

const ORIGIN = "https://cenoteka.rs"
const MAX_PRODUCT_FETCHES = 4

/** Term token → the brand slug Cenoteka uses in /b/<brand>/<category>/ URLs. */
const BRAND_TOKENS: Array<[RegExp, string]> = [
	[/(iphone|ipad|macbook|airpods|apple)/, "apple"],
	[/(galaxy|samsung)/, "samsung"],
	[/(redmi|xiaomi|pocophone|poco)/, "xiaomi"],
	[/(pixel)/, "google"],
	[/(playstation|plejstejsn|sony|bravia|\bwh\b)/, "sony"],
	[/(xbox|microsoft)/, "microsoft"],
	[/(nintendo|switch|svic)/, "nintendo"],
	[/(ideapad|thinkpad|lenovo)/, "lenovo"],
	[/(asus|tuf|rog|zenbook|vivobook)/, "asus"],
	[/(victus|\bhp\b)/, "hp"],
	[/(dell|inspiron)/, "dell"],
	[/(msi)/, "msi"],
	[/(\blg\b)/, "lg"],
	[/(huawei)/, "huawei"],
	[/(honor)/, "honor"],
	[/(garmin)/, "garmin"],
	[/(jbl)/, "jbl"],
	[/(bose)/, "bose"],
]

export type Tile = { slug: string; name: string; price: number; image: string | null }

/** The server-rendered ProductTile articles of a category page (18 popular items). */
export function parseCenotekaTiles(html: string): Tile[] {
	const tiles: Tile[] = []
	for (const block of html.split(/<article class="ProductTile/).slice(1)) {
		const card = block.slice(0, block.indexOf("</article>") > 0 ? block.indexOf("</article>") : block.length)
		const slug = card.match(/data-slug="([^"]+)"/)?.[1]
		const name = card.match(/data-name="([^"]+)"/)?.[1]
		const price = Number(card.match(/data-price="(\d+)"/)?.[1])
		if (!slug || !name || !Number.isFinite(price) || price <= 0) continue
		const image = card.match(/(https:\/\/api\.cenoteka\.rs\/uploads\/[^"'\s]+)/)?.[1] ?? null
		tiles.push({ slug, name, price, image })
	}
	return tiles
}

export type Offer = { shopId: string; shopName: string | null; price: number; url: string }

/** The per-shop offers of a /p/<slug>/ product page. The /redirect/ href is parsed, never fetched. */
export function parseCenotekaOffers(html: string, productUrl: string): Offer[] {
	const offers: Offer[] = []
	for (const block of html.split(/<details class="OfferList-module__[^"]*__offer">/).slice(1)) {
		const row = block.slice(0, block.indexOf("</details>") > 0 ? block.indexOf("</details>") : block.length)
		const href = row.match(/href="(\/redirect\/\?[^"]+)"/)?.[1]
		if (!href) continue
		// In the HTML the separators are &amp;; URLSearchParams then undoes the percent-encoding of redirect_url.
		const params = new URLSearchParams(decode(href).replace("/redirect/?", ""))
		const shopId = params.get("shop_id")
		const price = Number(params.get("product_price"))
		if (!shopId || !Number.isFinite(price) || price <= 0) continue

		// The real product URL at the shop, decoded from the redirect we are not allowed to call.
		const decoded = params.get("redirect_url")
		const url = decoded && decoded.startsWith("https://") ? decoded : productUrl

		const shopName = row.match(/alt="([^"]+)"/)?.[1]?.trim() || null
		offers.push({ shopId, shopName, price, url })
	}
	return offers
}

const decode = (s: string) =>
	s
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")

/** Tiles whose name contains every required term word, dropping accessories and generic category words. */
export function filterTiles(tiles: Tile[], term: string): Tile[] {
	const entry = pickCategory(term)
	if (!entry) return tiles
	const required = requiredWords(entry)
	if (!required.length) return tiles
	return tiles.filter((t) => !isAccessoryName(t.name) && nameMatches(normalize(t.name), required))
}

const fetchOk = customerFetch

export function createCenotekaAdapter(): SourceAdapter {
	return {
		id: "cenoteka",
		name: "Cenoteka",
		kind: "comparison",
		live: true,

		async search(term: string, page: number): Promise<SearchPage> {
			if (page > 1) return { listings: [], hasMore: false }
			const entry = pickCategory(term)
			if (!entry) return { listings: [], hasMore: false }

			const brand = BRAND_TOKENS.find(([re]) => entry.words.some((w) => re.test(w)))
			// A brand+category page has the same 18-tile shape but only that brand's items.
			const attempts = brand ? [`/b/${brand[1]}/${entry.cenoteka}/`, `/${entry.cenoteka}/`] : [`/${entry.cenoteka}/`]
			let tiles: Tile[] = []
			for (const path of attempts) {
				const html = await fetchOk(`${ORIGIN}${path}`)
				if (!html) continue
				tiles = parseCenotekaTiles(html)
				if (tiles.length) break
			}
			const matched = filterTiles(tiles, term)
			// Fewer than the strictest match: keep the category's popular items, still skipping accessories.
			const fallback = tiles.filter((t) => !isAccessoryName(t.name))
			const chosen = matched.length ? matched.slice(0, MAX_PRODUCT_FETCHES) : fallback.slice(0, MAX_PRODUCT_FETCHES)

			const listings: RawListing[] = []
			for (const tile of chosen) {
				const productUrl = `${ORIGIN}/p/${tile.slug}/`
				const html = await fetchOk(productUrl)
				if (!html) continue
				for (const offer of parseCenotekaOffers(html, productUrl)) {
					listings.push({
						source: "cenoteka",
						id: `${tile.slug}|${offer.shopId}`,
						url: offer.url,
						title: tile.name,
						description: null,
						price: offer.price,
						shipping: null,
						condition: "new",
						city: null,
						seller: null,
						shopId: offer.shopId,
						shopName: offer.shopName,
						image: tile.image,
					})
				}
			}
			return { listings, hasMore: false }
		},
	}
}
