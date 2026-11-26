/** All amounts are integer RSD. This MVP executes only simulated transactions. */
export type Goal = {
	title: string
	cash: number
	reserve: number
	deadlineDays: number
	minTrust: number
	minWarrantyMonths: number
	wishes: { id: string; productId: string; name: string; priority: number }[]
	assets: { id: string; productId: string; name: string; condition: "good" | "fair"; fee: number; delivery: number }[]
}
export type Offer = {
	id: string; productId: string; name: string; price: number; delivery: number | null
	seller: string; trust: number; warrantyMonths: number; condition: "new" | "used"
	history: number[]; advertisedPrevious: number; synthetic: true
}
export type Resale = {
	assetId: string; gross: number; net: number; low: number; high: number
	confidence: "low" | "medium"; days: number; comparables: number; basis: "synthetic asking prices"
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
	startMs: number; endMs?: number; status: "running" | "accepted" | "stale" | "error"
	mode: "offline analysis" | "LLM reasoning"; detail?: string
}
export type FinanceView = {
	id: string; revision: number; sequence: number; goal: Goal; offers: Offer[]; resale: Resale[]; ledger: Ledger; plan: Plan
	reason: string; history: { revision: number; reason: string }[]; runs: AgentRun[]
	notes: Record<string, string>; pending: number; synthetic: true
}
export type Command =
	| { type: "resale-drop" }
	| { type: "cheaper-offer" }
	| { type: "trust-drop" }
	| { type: "refresh" }
	| { type: "confirm-sale"; assetId: string; gross: number }
	| { type: "reserve"; offerId: string }
	| { type: "release"; offerId: string }
	| { type: "buy"; offerId: string }
export type CommandRequest = { revision: number; requestId: string; command: Command }
