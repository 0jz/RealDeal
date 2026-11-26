export type Shop = { id: string; name: string }

export type Sku = { id: string; name: string; category: string; basePrice: number }

/** How an offer's Black Friday "discount" was planted by the generator. */
export type Pattern =
	| "honest" // real discount, shown previous price = real 30-day low
	| "presale-hike" // price hiked before the sale, then a big fake "-40%"
	| "inflated-prev" // shown previous price higher than any real price in 30 days
	| "new-item" // in stock < 30 days: 15-day rule applies (honest)
	| "tiny" // "discount" of a few dinars
	| "no-sale" // no discount at all

export type Offer = {
	shopId: string
	skuId: string
	pattern: Pattern
	/** 60 daily prices in RSD, index 0 = 60 days before Black Friday, 59 = the day before. null = not in stock yet. */
	history: (number | null)[]
	bfPrice: number
	shownPrevPrice: number
}

export type KpCondition = "new-sealed" | "used"

export type KpListing = { id: string; skuId: string; title: string; price: number; condition: KpCondition; city: string }

export type Dataset = { seed: number; shops: Shop[]; skus: Sku[]; offers: Offer[]; kp: KpListing[] }
