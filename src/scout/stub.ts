// Offline stand-in shops for tests and `npm run check:finance`: no network, deterministic listings.
// Each search returns one listing whose title repeats the query, so the offline judge accepts it.

import type { shopDeps } from "./shops"
import type { ScoutCandidate } from "./types"

const PREFIX = "https://ananas.rs/proizvod/stub/"

export function stubShops(price = 39_999): typeof shopDeps {
	const read = async (url: string): Promise<ScoutCandidate | null> => {
		if (!url.startsWith(PREFIX)) return null
		const query = decodeURIComponent(url.slice(PREFIX.length))
		return { site: "ananas", shop: "Ananas", title: `${query} (test listing)`, price, delivery: 0, inStock: true, url, image: "https://ananas.rs/stub.jpg", checkedAt: new Date().toISOString() }
	}
	return () => ({
		scouts: [{ site: "ananas", search: async query => [PREFIX + encodeURIComponent(query)], read }],
		offNotes: { officeshoes: "stub" },
		verify: { reread: l => read(l.url), contentType: async () => "image/jpeg" },
	})
}
