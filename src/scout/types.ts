import type { BudgetGroup } from "../search/budget"

// The scouting contract. Every scout, the judge, the ranker, the engine and the
// result page code against these types. See docs/SCOUTS_PROMPT.md.
//
// Every number here comes from a page a scout fetched during this plan. Nothing is
// taken from the catalogue (msrp / typicalPrice), which new plans never read.
// Tehnomedia, Ananas, Computers.rs and Office Shoes are shops read directly; eponuda and Cenoteka
// are comparison sites read through the customer profile (src/sources/customer.ts).

/** Sites the scouts can report (see docs/LEGAL_REFERENCE.md). */
export type ScoutSite = "tehnomedia" | "ananas" | "officeshoes" | "gigatron" | "eponuda" | "cenoteka" | "computers"

export const SCOUT_SITES: ScoutSite[] = ["tehnomedia", "ananas", "officeshoes", "gigatron", "eponuda", "cenoteka", "computers"]

export const SITE_NAMES: Record<ScoutSite, string> = {
	tehnomedia: "Tehnomedia",
	ananas: "Ananas",
	officeshoes: "Office Shoes",
	gigatron: "Gigatron",
	eponuda: "eponuda",
	cenoteka: "Cenoteka",
	computers: "Computers.rs",
}

/** A product as an adapter read it from the shop's own product page. */
export type ScoutCandidate = {
	site: ScoutSite
	shop: string
	title: string
	/** Product category or breadcrumb read from the same shop page. */
	category?: string
	/** Exact integer RSD, as shown on the page. */
	price: number
	delivery: number | null
	inStock: boolean | null
	/** The exact product page the user can open and buy from. */
	url: string
	/** https only, from the same page (JSON-LD image, else og:image). */
	image: string | null
	checkedAt: string
}

/** A candidate the judge kept, with its score and reason. */
export type ScoutListing = ScoutCandidate & {
	score: number
	reason: string
	verified: boolean
}

export type SiteStatus = "ok" | "blocked" | "off" | "skipped" | "error" | "timeout"

export type SiteReport = { status: SiteStatus; pages: number; found: number; note?: string }

/** Why a candidate was dropped, for the "What the scouts read" panel. */
export type DropReason = "out of range" | "accessory" | "mismatch" | "low score" | "duplicate" | "failed verify" | "unavailable"

export type ScoutTrace = ScoutCandidate & { score: number | null; kept: boolean; why: string; drop?: DropReason }

export type ScoutResult = {
	/** Budget, middle and top; absent only on older saved plans or uncapped searches. */
	budgetTiers?: BudgetGroup<ScoutListing>[]
	wantText: string
	query: string
	minPrice?: number
	maxPrice?: number
	best: ScoutListing | null
	/** Places 2–3: 0–2 items. */
	next: ScoutListing[]
	/** Places 4–10: 0–7 items. */
	mentions: ScoutListing[]
	sites: Record<ScoutSite, SiteReport>
	/** Every candidate read, kept or dropped. */
	trace: ScoutTrace[]
	finishedAt: string
}

/** What a scouting run needs to know about one thing to buy. */
export type ScoutWant = {
	/** null means the limit is inherited from the plan budget. */
	requestedMaxPrice?: number | null
	wantText: string
	query: string
	attributes: string[]
	minPrice?: number
	maxPrice?: number
}

/** One shop adapter. search() returns product page URLs; read() parses one product page. */
export type ShopScout = {
	site: ScoutSite
	/** The adapter can search separate price bands. */
	supportsPriceRange?: boolean
	/** Product page URLs for a query, best first. Throws ScoutBlocked when the shop answers with a challenge. */
	search(query: string, range: { minPrice?: number; maxPrice?: number }): Promise<string[]>
	/** Parses a fetched product page. null when it has no clean price. */
	read(url: string): Promise<ScoutCandidate | null>
}

export class ScoutBlocked extends Error {}
