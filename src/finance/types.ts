import type { Category } from "../search/types"

/** All amounts are integer RSD. Prices come from the user; nothing is bought or sold by the app. */
/** Where a price came from: the user ("your price") or the catalogue msrp ("typical price (estimate)"). Missing = "you". */
export type PriceSource = "you" | "catalogue"
export type Wish = {
	id: string; name: string; priority: number
	/** The offer the user found: price, delivery (null = unknown), shop, optional link. */
	price: number; delivery: number | null; shop: string; link: string
	warrantyMonths: number; condition: "new" | "used"
	priceSource?: PriceSource
}
export type Asset = {
	id: string; name: string; condition: "good" | "fair"
	/** What the user expects to get. Null = estimate it from the catalogue's typical price. */
	expectedPrice: number | null; fee: number; delivery: number; days: number
}
export type Goal = {
	title: string
	cash: number
	reserve: number
	deadlineDays: number
	minWarrantyMonths: number
	wishes: Wish[]
	assets: Asset[]
}
export type Offer = {
	id: string; wishId: string; productId: string | null; name: string; price: number; delivery: number | null
	shop: string; link: string; warrantyMonths: number; condition: "new" | "used"
	/** Rough typical new price from the catalogue, when the name matches a known product. */
	typicalPrice: number | null
	priceSource?: PriceSource
	risks: string[]; blocked: boolean
}
export type Resale = {
	assetId: string; gross: number; net: number; low: number; high: number
	confidence: "low" | "medium"; days: number; basis: "your price" | "catalogue estimate"
}
export type Ledger = {
	confirmedResale: number; spent: number; verifiedSavings: number
	sold: string[]; purchased: string[]; reservations: Record<string, number>
	receipts: Record<string, { fingerprint: string; message: string }>
}
export type Action = {
	kind: "buy" | "sell" | "wait"; id: string; name: string; amount: number; why: string; when: string
}
export type Plan = {
	actions: Action[]; selectedOffers: string[]; selectedAssets: string[]
	availableCash: number; reservedCash: number; estimatedResale: number; expectedCosts: number
	confirmedResale: number; actualCosts: number; projectedRemaining: number; netAcquisitionCost: number
	verifiedSavings: number; forecastSavings: number; conditional: boolean; complete: boolean
}
export type AgentRun = {
	id: number; agent: string; revision: number; cycle: number; startedAt: string; finishedAt?: string
	/** performance.now() when the run was launched; startMs is when inference actually began. */
	queuedMs?: number
	startMs: number; endMs?: number; status: "running" | "accepted" | "stale" | "error"
	mode: "offline analysis" | "LLM reasoning"; detail?: string
}
/** What a free-text prompt asked for. Structure only: prices are never invented, only read from the prompt. */
export type IntentWant = {
	text: string; productId?: string; category?: Category
	/** "laptop do 100 hiljada": an upper limit, not a price. */
	maxPrice?: number
	/** "iPhone 15 za 85k": the price the user wrote next to the item. */
	price?: number
	/** 1 = first mentioned = most important. */
	priority: number
}
export type IntentSell = { text: string; productId?: string; condition: "good" | "fair"; expectedPrice?: number }
export type Intent = {
	wants: IntentWant[]; sells: IntentSell[]
	/** Cash available, when the prompt states it ("imam 75k", "budget 75000"). */
	budget?: number
	reserve?: number; deadlineDays?: number
}
export type FinanceView = {
	id: string; revision: number; sequence: number; goal: Goal; offers: Offer[]; resale: Resale[]; ledger: Ledger; plan: Plan
	reason: string; history: { revision: number; reason: string }[]; runs: AgentRun[]
	notes: Record<string, string>; pending: number; updatedAt: string
	/** Set when the plan came from a prompt. */
	intent?: Intent
	/** Per wish id: other catalogue product ids the user can swap to (same category). */
	alternatives?: Record<string, string[]>
}
export type Command =
	| { type: "refresh" }
	| { type: "update-goal"; goal: Goal }
	| { type: "confirm-sale"; assetId: string; gross: number }
	| { type: "reserve"; offerId: string }
	| { type: "release"; offerId: string }
	/** `paid` is what was actually paid; required when the offer price is a catalogue estimate. */
	| { type: "buy"; offerId: string; paid?: number }
export type CommandRequest = { revision: number; requestId: string; command: Command }
