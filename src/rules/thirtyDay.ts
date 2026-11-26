import type { Offer } from "../data/types"

export type ThirtyDayResult = {
	/** Lowest real price in the reference window. */
	realLow: number
	/** 30, or 15 for items in stock less than 30 days. */
	windowDays: 30 | 15
	/** Shown previous price respects the rule. */
	legal: boolean
	/** Discount off the real low, in percent (negative = price went up). */
	realDiscountPct: number
	claimedDiscountPct: number
}

/**
 * Serbia's 30-day rule (consumer protection law, in force since 1 May 2026):
 * the advertised previous price must be the lowest price in the 30 days before
 * the sale, or in the last 15 days for products in stock less than 30 days.
 */
export function checkThirtyDay(offer: Pick<Offer, "history" | "shownPrevPrice">, salePrice: number): ThirtyDayResult {
	const last30 = offer.history.slice(-30)
	const inStockDays = last30.filter((p) => p !== null).length
	const windowDays = inStockDays < 30 ? 15 : 30
	const window = offer.history.slice(-windowDays).filter((p): p is number => p !== null)
	const realLow = Math.min(...window)
	const pct = (from: number) => Math.round(((from - salePrice) / from) * 1000) / 10

	return {
		realLow,
		windowDays,
		// The rule only binds when a discount is advertised at all.
		legal: offer.shownPrevPrice <= salePrice || offer.shownPrevPrice <= realLow,
		realDiscountPct: pct(realLow),
		claimedDiscountPct: pct(offer.shownPrevPrice),
	}
}
