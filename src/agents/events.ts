// Event contract between agents. Agree on these first; change them rarely.

export const EV = {
	priceChanged: "price.changed",
	discountVerified: "discount.verified",
	discountFake: "discount.fake",
	kpPrice: "kp.price",
} as const

export type PriceChanged = { shopId: string; skuId: string; price: number; shownPrevPrice: number }

export type DiscountChecked = PriceChanged & {
	realLow: number
	windowDays: 30 | 15
	claimedDiscountPct: number
	realDiscountPct: number
}

export type KpPrice = { skuId: string; shopId: string; shopPrice: number; sealedLow: number | null; usedLow: number | null; listingId: string | null }
