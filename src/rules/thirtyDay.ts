type Offer = {
	history: (number | null)[]
	shownPrevPrice: number
	/** Explicit assortment age; gaps in observations do NOT establish a new product. */
	assortmentDays?: number
	perishable?: boolean
	/** Use the pre-campaign reference window for an uninterrupted progressive reduction. */
	campaignReferenceHistory?: (number | null)[]
}

export type ThirtyDayResult = {
	realLow: number
	windowDays: number
	/** Compatibility field: reference consistency only, NOT a legal finding. */
	legal: boolean
	status: "consistent" | "misleading-reference" | "insufficient-history" | "exception"
	realDiscountPct: number
	claimedDiscountPct: number
}

/**
 * Reference-price screening, not a legal verdict. Trade Law amendment (35/2026),
 * article 14 amending article 37: ordinarily 30 days; assortment <30 days requires
 * at least 15 days; perishables/short shelf life excluded; progressive reductions
 * retain the pre-campaign reference. See docs/LEGAL_REFERENCE.md.
 */
export function checkThirtyDay(offer: Offer, salePrice: number): ThirtyDayResult {
	const age = offer.assortmentDays
	const windowDays = age != null && age < 30 ? Math.max(15, age) : 30
	const history = offer.campaignReferenceHistory ?? offer.history
	const window = history.slice(-windowDays)
	const valid = window.filter((p): p is number => p !== null && Number.isFinite(p) && p > 0)
	const realLow = valid.length ? Math.min(...valid) : 0
	const pct = (from: number) => from > 0 ? Math.round(((from - salePrice) / from) * 1000) / 10 : 0
	const complete = valid.length === windowDays && (age == null || age >= 15) && Number.isFinite(salePrice) && salePrice > 0 && Number.isFinite(offer.shownPrevPrice) && offer.shownPrevPrice > 0
	const consistent = complete && (offer.shownPrevPrice <= salePrice || offer.shownPrevPrice <= realLow)
	const status = offer.perishable ? "exception" : !complete ? "insufficient-history" : consistent ? "consistent" : "misleading-reference"
	return { realLow, windowDays, legal: status === "consistent", status, realDiscountPct: pct(realLow), claimedDiscountPct: pct(offer.shownPrevPrice) }
}
