// Computers.rs public laptop category and product HTML. No cart requests.
import { politeFetch } from "../sources/http"
import { resolveQuery } from "../search/matcher"
import { judgeOffline } from "./judge"
import { inRange, MIN_SCORE } from "./rank"
import { ScoutBlocked, type ScoutCandidate, type ShopScout } from "./types"

const ORIGIN = "https://www.computers.rs"
const CATEGORY = `${ORIGIN}/artikli/laptopovi-i-tableti/laptopovi-i-oprema/laptop/0/0/0-0`
const PRODUCT = `${ORIGIN}/artikal/`
type Range = Parameters<ShopScout["search"]>[1]

const clean = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()
const amount = (s: string) => Number(s.replace(/[.\s]/g, "").replace(",", "."))

/** Hints from actual result cards; prices are re-read on each product page. */
export function parseComputersSearch(html: string, query: string, range: Range): string[] {
	const urls: string[] = []
	const cards = html.split(/<section\b[^>]*class=["']product list-product-on-480["'][^>]*>/i).slice(1)
	for (const card of cards) {
		const link = card.match(/<a\b[^>]*class=["']product-title["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
		const rawPrice = card.match(/class=["']product-price\s[^"']*["'][^>]*>([\d.,\s]+)/i)?.[1]
		if (!link || !link[1]!.startsWith(PRODUCT) || !rawPrice || !inRange(amount(rawPrice), range)) continue
		if (/Nije dostupno/i.test(clean(card))) continue
		// The image alt holds the full name; the visible link is truncated.
		const title = card.match(/<img\b[^>]*class=["']product-image["'][^>]*alt=["']([^"']*)["']/i)?.[1] ?? link[2]!
		if (judgeOffline({ wantText: query, query, attributes: [] }, { title: clean(title), category: "Laptop" }).score < MIN_SCORE) continue
		urls.push(link[1]!)
	}
	return [...new Set(urls)]
}

export function parseComputersProduct(html: string, url: string, now: string): ScoutCandidate | null {
	const page = html.replace(/<!--[\s\S]*?-->/g, "")
	const product = page.split(/<section\b[^>]*id=["']product-preview["'][^>]*>/i)[1]
	if (!product) return null
	const title = product.match(/<h1\b[^>]*itemprop=["']name["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1]
	const priceBlock = product.match(/<section\b[^>]*class=["']product-preview-price["'][^>]*>([\s\S]*?)<\/section>/i)?.[1]
	// MPC is the higher retail price; the payable online price follows "PDV-om".
	const priceMatch = priceBlock && clean(priceBlock).match(/Cena sa PDV\s*-om\s*([\d.,\s]+)\s*din\./i)
	const price = priceMatch ? amount(priceMatch[1]!) : NaN
	if (!title || !Number.isFinite(price) || price <= 0) return null
	const breadcrumbs = page.match(/<ul\b[^>]*class=["']breadcrumbs[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i)?.[1] ?? ""
	const category = [...breadcrumbs.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].slice(1).map(m => clean(m[1]!)).join(" > ")
	const image = product.match(/<img\b[^>]*itemprop=["']image["'][^>]*src=["']([^"']+)["']/i)?.[1]
	return {
		site: "computers", shop: "Computers.rs", title: clean(title), category,
		price: Math.round(price), delivery: null,
		// This shop's order button is not a stock assertion. Preserve uncertainty.
		inStock: /Nije dostupno/i.test(clean(product.split(/product-preview-tabs/i)[0]!)) ? false : null,
		url, image: image?.startsWith("https://") ? image : null, checkedAt: now,
	}
}

export function createComputersScout(fetchPage: (url: string) => Promise<string> = politeFetch): ShopScout {
	async function get(url: string) {
		try {
			const html = await fetchPage(url)
			if (/cf-challenge|__cf_chl_|challenge-platform|just a moment\.\.\./i.test(html)) throw new ScoutBlocked("Computers.rs challenged the request")
			return html
		} catch (err) {
			if (err instanceof Error && /\b403\b|blocked by robots/i.test(err.message)) throw new ScoutBlocked(err.message)
			throw err
		}
	}
	return {
		site: "computers", supportsPriceRange: true,
		async search(query, range) {
			if (resolveQuery(query).category !== "laptop") return []
			const first = await get(CATEGORY)
			// Follow only the shop's own pagination links, with a strict request cap.
			const next = [...first.matchAll(/href=["']([^"']+\?page=\d+)["']/g)]
				.map(m => m[1]!).filter(u => u.startsWith(`${CATEGORY}?page=`) && !u.endsWith("=1"))
			const pages = [first]
			for (const url of [...new Set(next)].slice(0, 2)) pages.push(await get(url))
			return [...new Set(pages.flatMap(html => parseComputersSearch(html, query, range)))]
		},
		async read(url) {
			if (!url.startsWith(PRODUCT)) return null
			return parseComputersProduct(await get(url), url, new Date().toISOString())
		},
	}
}
