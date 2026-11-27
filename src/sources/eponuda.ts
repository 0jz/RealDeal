// Live adapter for eponuda (www.eponuda.com), on only when LIVE_SOURCES includes "eponuda".
//
// eponuda's robots.txt allows general browsing but explicitly disallows the
// paths a naive scraper would use: /uporedicene (their search), /link (shop
// redirects) and every ?brand/sortBy/minPrice/maxPrice filter URL. So this
// adapter never calls search: it reads the category pages robots allows
// (e.g. /mobilni-telefoni-cene), which are server-rendered product cards with
// the best price and shop of each product, and filters them locally by the
// search term. Listing URLs are eponuda's /link redirects carried for the
// user to click — never fetched by us.
//
// Cloudflare: see customer.ts for the customer profile, the curl transport
// and the measured rate-limit behaviour. One search costs one cached category
// page per category, shared by every term that maps to it.

import { customerFetch } from "./customer"
import { isAccessoryName, nameMatches, pickCategory, requiredWords } from "./categories"
import { normalize } from "./fixture"
import type { RawListing, SearchPage, SourceAdapter } from "../search/types"

const ORIGIN = "https://www.eponuda.com"
const PAGE_SIZE = 12

export type Card = {
	id: string
	title: string
	price: number
	shopId: string | null
	shopName: string | null
	url: string
	image: string | null
}

const decode = (s: string) =>
	s
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ")

const stripTags = (s: string) => decode(s.replace(/<[^>]+>/g, ""))

/** "46.990,00" and "46990.00" both read as 46990. */
function rsdNumber(text: string): number | null {
	const m = text.match(/(\d[\d.\s]*)(?:,(\d+))?/)
	if (!m) return null
	const whole = m[1]!.replace(/[\s.]/g, "")
	const result = Number(`${whole}.${m[2] ?? "0"}`)
	return Number.isFinite(result) && result > 0 ? Math.round(result) : null
}

/** Parses the server-rendered product cards of a category page (same markup as their search results). */
export function parseEponudaCards(html: string): Card[] {
	const cards: Card[] = []
	for (const block of html.split(/<div class="sbc-card sbc-card-b"/).slice(1)) {
		const cut = block.indexOf('<div class="clear"></div>')
		const card = cut < 0 ? block : block.slice(0, cut)

		const title = stripTags(card.match(/<h3 class="sbc-card__name"[^>]*>([\s\S]*?)<\/h3>/)?.[1] ?? "").trim()
		if (!title) continue

		const price = rsdNumber(card.match(/event-viewitem-price="([\d.,]+)"/)?.[1] ?? "") ?? rsdNumber(card.match(/event-ctaclick-pricemin="([\d.,]+)"/)?.[1] ?? "")
		if (price === null) continue

		// Category cards link to eponuda's own product page (/brand/…-cena-<id>); sponsored cards
		// link straight through the outbound /link redirect. Either works as a listing URL;
		// only the /link one is ever disallowed to fetch, and we fetch neither.
		const internal = card.match(/href="(\/[^"]*-cena-(\d+))"/)
		const outbound = card.match(/href="(\/link\?[^"]+)"/)?.[1]
		const url = internal ? `${ORIGIN}${internal[1]}` : outbound ? `${ORIGIN}${decode(outbound)}` : null
		if (!url) continue
		const shopId = url.includes("/link?") ? url.match(/prodavac=(\d+)/)?.[1] ?? null : null
		const id = internal?.[2] ?? card.match(/event-ctaclick-productid="(\d+)"/)?.[1] ?? url.match(/pr=(\d+)/)?.[1] ?? url

		// "u Fonly" — the shop behind the best price.
		const shopName = stripTags(card.match(/class="sbc-card__meta">\s*u?\s*([^<]+?)</)?.[1] ?? "").trim() || null

		const image = card.match(/(https:\/\/img\.ep-cdn\.com\/[^"'\s]+)/)?.[1] ?? null

		cards.push({ id, title, price, shopId, shopName, url, image })
	}
	return cards
}

/** Cards whose title contains every required term word, dropping accessories and generic category words. */
export function filterCards(cards: Card[], term: string): Card[] {
	const entry = pickCategory(term)
	if (!entry) return cards
	const required = requiredWords(entry)
	if (!required.length) return cards
	return cards.filter((c) => !isAccessoryName(c.title) && nameMatches(normalize(c.title), required))
}

function toListing(c: Card): RawListing {
	return {
		source: "eponuda",
		id: c.id,
		url: c.url,
		title: c.title,
		description: null,
		price: c.price,
		shipping: null,
		condition: "new",
		city: null,
		seller: null,
		shopId: c.shopId,
		shopName: c.shopName,
		image: c.image,
	}
}

export function createEponudaAdapter(): SourceAdapter {
	return {
		id: "eponuda",
		name: "eponuda",
		kind: "comparison",
		live: true,

		async search(term: string, page: number): Promise<SearchPage> {
			const entry = pickCategory(term)
			if (!entry) return { listings: [], hasMore: false }

			const html = await customerFetch(`${ORIGIN}/${entry.eponuda}`)
			if (!html) return { listings: [], hasMore: false }
			const all = parseEponudaCards(html)
			const matched = filterCards(all, term)

			const start = (Math.max(1, page) - 1) * PAGE_SIZE
			return { listings: matched.slice(start, start + PAGE_SIZE).map(toListing), hasMore: start + PAGE_SIZE < matched.length }
		},
	}
}
