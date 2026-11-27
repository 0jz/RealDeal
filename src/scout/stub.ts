// Offline stand-in shops for tests and `npm run check:finance`: no network, deterministic listings.
// Each search returns one listing whose title is a real catalogue device for the query, so the
// offline judge accepts it the same way a real listing would.

import { resolveQuery } from "../search/matcher"
import { CATALOGUE, isCategoryWord, PRODUCTS } from "../search/catalogue"
import type { shopDeps } from "./shops"
import type { ScoutCandidate } from "./types"

const PREFIX = "https://ananas.rs/proizvod/stub/"

/** A realistic device title for the query, so the offline judge accepts it the way a real listing would. */
function titleFor(query: string): string {
	const { productIds, category } = resolveQuery(query)
	// A category word ("phone") maps to a representative device, not a fuzzy brand match ("iphone").
	const product = isCategoryWord(query)
		? (category ? CATALOGUE.find((p) => p.category === category) : undefined)
		: productIds.length
			? PRODUCTS.get(productIds[0]!)
			: undefined
	return product ? `${product.model} (test listing)` : `${query} (test listing)`
}

export function stubShops(price = 39_999): typeof shopDeps {
	const read = async (url: string): Promise<ScoutCandidate | null> => {
		if (!url.startsWith(PREFIX)) return null
		const query = decodeURIComponent(url.slice(PREFIX.length))
		return { site: "ananas", shop: "Ananas", title: titleFor(query), price, delivery: 0, inStock: true, url, image: "https://ananas.rs/stub.jpg", checkedAt: new Date().toISOString() }
	}
	return () => ({
		scouts: [{ site: "ananas", search: async query => [PREFIX + encodeURIComponent(query)], read }],
		offNotes: { officeshoes: "stub" },
		verify: { reread: l => read(l.url), contentType: async () => "image/jpeg" },
	})
}
