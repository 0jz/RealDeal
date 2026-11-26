// Event contract between agents. Agree on these first; change them rarely.

export const EV = {
	priceChanged: "price.changed",
	discountVerified: "discount.verified",
	discountFake: "discount.fake",
	kpPrice: "kp.price",
	crossShopBest: "crossshop.best",
	shopTrustChanged: "shop.trust.changed",
	verdictUpdated: "verdict.updated",
} as const

export type PriceChanged = { shopId: string; skuId: string; price: number; shownPrevPrice: number }

export type DiscountChecked = PriceChanged & {
	realLow: number
	windowDays: 30 | 15
	claimedDiscountPct: number
	realDiscountPct: number
}

export type KpPrice = { skuId: string; shopId: string; shopPrice: number; sealedLow: number | null; usedLow: number | null; listingId: string | null }

export type CrossShopBest = { skuId: string; shopId: string; shopPrice: number; bestShopId: string | null; bestPrice: number | null }

export type ShopTrustChanged = { shopId: string; trust: number; previous: number; skuId: string; caught: boolean }

export type Verdict = "CHECKING" | "REAL DEAL" | "FAKE DISCOUNT" | "BUY ON KP INSTEAD" | "WAIT"

/** Everything VerdictAgent knows about one offer. Fields fill in as agents report. */
export type VerdictRecord = {
	shopId: string
	skuId: string
	price: number
	discount?: DiscountChecked & { legal: boolean }
	kp?: KpPrice
	crossShop?: CrossShopBest
	verdict: Verdict
	reason: string
	updatedAt: number
}

export type VerdictUpdated = { shopId: string; skuId: string; verdict: Verdict; previous: Verdict; reason: string; cause: string }
