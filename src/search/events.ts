// Event contract between the search agents. Every payload carries searchId,
// so many searches (web + Telegram) run on the one runtime at once.

import type { Category, MatchResult, PriceFlag, RawListing, SearchRequest } from "./types"

export const EV = {
	searchRequested: "search.requested",
	searchPlanned: "search.planned",
	pageNext: "page.next",
	listingFound: "listing.found",
	listingMatched: "listing.matched",
	listingRejected: "listing.rejected",
	priceAssessed: "price.assessed",
	discountChecked: "discount.checked",
	shopTrustChanged: "shop.trust.changed",
	sourceDone: "source.done",
	resultsUpdated: "results.updated",
	sellEstimate: "sell.estimate",
} as const

export type SearchRequested = { searchId: string; request: SearchRequest }

export type SearchPlanned = {
	searchId: string
	/** Literal strings each source searches for: the query plus its known spellings. */
	terms: string[]
	/** Products the query points at. Empty = category or free-text search. */
	productIds: string[]
	category: Category | null
	storageGb: number | null
}

export type PageNext = { searchId: string; source: string; term: string; page: number }

export type ListingFound = { searchId: string; term: string; listing: RawListing }

export type ListingMatched = { searchId: string; key: string; listing: RawListing; match: MatchResult }

export type ListingRejected = { searchId: string; key: string; title: string; reason: string }

export type PriceAssessed = { searchId: string; key: string; productId: string; market: number | null; flag: PriceFlag }

export type DiscountChecked = {
	searchId: string
	key: string
	shopId: string
	legal: boolean
	realLow: number
	claimedPct: number
	realPct: number
}

export type ShopTrustChanged = { shopId: string; trust: number; previous: number; caught: boolean }

export type SourceDone = { searchId: string; source: string; pages: number; found: number; reason: string }
