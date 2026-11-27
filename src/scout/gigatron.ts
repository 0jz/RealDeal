// Gigatron scout: wraps the existing adapter, which matches terms against sitemap
// slugs because Gigatron's own search is robots-disallowed. Personal, non-commercial
// prototype use only — see the terms note in src/sources/gigatron.ts.

import { findGigatronProductUrls, parseProduct } from "../sources/gigatron"
import { politeFetch } from "../sources/http"
import { ScoutBlocked, type ShopScout } from "./types"

const CHALLENGE = /cf-challenge|cf-browser-verification|__cf_chl_|challenge-platform|just a moment\.\.\.|attention required!/i

async function get(fetchPage: (url: string) => Promise<string>, url: string): Promise<string> {
	let html: string
	try {
		html = await fetchPage(url)
	} catch (err) {
		if (err instanceof Error && /\b403\b|cf-mitigated|blocked by robots/i.test(err.message)) throw new ScoutBlocked(`Gigatron blocked ${url}`)
		throw err
	}
	if (CHALLENGE.test(html)) throw new ScoutBlocked(`Gigatron blocked ${url}`)
	return html
}

export function createGigatronScout(fetchPage: (url: string) => Promise<string> = politeFetch): ShopScout {
	return {
		site: "gigatron",
		async search(query) {
			return findGigatronProductUrls(query)
		},
		async read(url) {
			const raw = parseProduct(await get(fetchPage, url), url)
			if (!raw) return null
			return {
				site: "gigatron",
				shop: "Gigatron",
				title: raw.title,
				price: raw.price,
				delivery: raw.shipping ?? null,
				inStock: true, // parseProduct only returns offers that are available
				url: raw.url,
				image: raw.image?.startsWith("https://") ? raw.image : null,
				checkedAt: new Date().toISOString(),
			}
		},
	}
}
