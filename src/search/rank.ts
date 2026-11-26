// Pure scoring rules: market price, price flags, row score, budget picks and
// sell estimates. No I/O and no LLM, so every decision is explainable and tested.

import { PRODUCTS, productName } from "./catalogue"
import type { Condition, Pick as BudgetPick, PriceFlag, ResultRow, SellEstimate } from "./types"

export const TRUST_THRESHOLD = 60
/** Below this match confidence a row is shown but never picked. */
export const MIN_PICK_CONFIDENCE = 0.7

const rsd = (n: number) => `${Math.round(n).toLocaleString("sr-RS")} RSD`

export const conditionGroup = (c: Condition | null | undefined): "new" | "used" => (c === "used" ? "used" : "new")

/** Baseline price before enough listings are in: msrp for new, 65% of it for used, +12% per storage doubling. */
export function baselinePrice(productId: string, condition: Condition | null, storageGb: number | null): number | null {
	const p = PRODUCTS.get(productId)
	if (!p) return null
	let price = conditionGroup(condition) === "used" ? p.msrp * 0.65 : p.msrp
	const base = p.storages?.[0]
	if (base && storageGb && storageGb > base) price *= 1 + 0.12 * Math.log2(storageGb / base)
	return Math.round(price)
}

export function median(xs: number[]): number | null {
	if (!xs.length) return null
	const s = [...xs].sort((a, b) => a - b)
	const m = s.length >> 1
	return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

export function percentile(xs: number[], p: number): number | null {
	if (!xs.length) return null
	const s = [...xs].sort((a, b) => a - b)
	const i = Math.min(s.length - 1, Math.max(0, (s.length - 1) * p))
	const lo = Math.floor(i)
	return Math.round(s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo))
}

/** Market price from comparable prices seen so far; falls back to the baseline with fewer than 3. */
export function marketPrice(comparable: number[], baseline: number | null): number | null {
	if (comparable.length >= 3) return median(comparable)
	return baseline
}

/** Too-cheap only counts as suspicious on classifieds: that's where scams live. */
export function priceFlag(total: number, market: number | null, classified: boolean): PriceFlag {
	if (!market) return "fair"
	const r = total / market
	if (classified && r < 0.55) return "suspicious"
	if (r < 0.85) return "great"
	if (r < 0.95) return "good"
	if (r <= 1.08) return "fair"
	return "high"
}

const FLAG_BONUS: Record<PriceFlag, number> = { great: 6, good: 3, fair: 0, high: -6, suspicious: -40 }
const CONDITION_BONUS: Record<Condition, number> = { sealed: 6, new: 5, used: 0 }

/** Row score: how good a buy this row is. Device quality first, then condition, price vs market, trust. */
export function rowScore(r: Pick<ResultRow, "productId" | "condition" | "flag" | "confidence" | "thirtyDay" | "shopTrust" | "storageGb">): number {
	const p = PRODUCTS.get(r.productId)
	let s = p?.score ?? 0
	if (r.condition) s += CONDITION_BONUS[r.condition]
	if (r.flag) s += FLAG_BONUS[r.flag]
	if (p?.storages?.[0] && r.storageGb && r.storageGb > p.storages[0]) s += 2 * Math.log2(r.storageGb / p.storages[0])
	if (r.thirtyDay && !r.thirtyDay.legal) s -= 8
	if (r.shopTrust != null && r.shopTrust < TRUST_THRESHOLD) s -= 10
	s -= (1 - r.confidence) * 20
	return Math.round(s * 10) / 10
}

export function rowWhy(r: ResultRow): string {
	const parts: string[] = []
	if (r.condition) parts.push({ sealed: "zapakovan", new: "nov", used: "polovan" }[r.condition])
	if (r.market && r.flag === "great") parts.push(`${Math.round((1 - r.total / r.market) * 100)}% ispod tržišne cene`)
	else if (r.market && r.flag === "good") parts.push("ispod tržišne cene")
	else if (r.flag === "high") parts.push("skuplje od tržišne cene")
	else if (r.flag === "suspicious") parts.push("sumnjivo jeftino")
	if (r.thirtyDay && !r.thirtyDay.legal) parts.push(`neusklađena referentna cena: zabeleženi minimum za 30 dana ${rsd(r.thirtyDay.realLow)}`)
	if (r.shopTrust != null && r.shopTrust < TRUST_THRESHOLD) parts.push(`neusklađene referentne cene prodavnice (poverenje ${r.shopTrust})`)
	if (r.method === "fuzzy") parts.push("naziv ispravljen")
	return parts.join(", ")
}

/** The hard budget cap. Nothing over it may ever be picked. Separate so it can be tested on its own. */
export function withinBudget<T extends { total: number }>(rows: T[], budget: number): T[] {
	return rows.filter((r) => Number.isFinite(r.total) && r.total <= budget)
}

/** A row we'd recommend at all: confidently matched, not a scam price, not a fake discount, not from a caught shop. */
export const pickable = (r: ResultRow) =>
	r.confidence >= MIN_PICK_CONFIDENCE &&
	r.flag !== "suspicious" &&
	!(r.thirtyDay && !r.thirtyDay.legal) &&
	!(r.shopTrust != null && r.shopTrust < TRUST_THRESHOLD)

/** How far under its market price a row is (0.2 = 20% under). */
const discountVsMarket = (r: ResultRow) => (r.market ? 1 - r.total / r.market : 0)

/**
 * Best buys. Budget mode: the best device you can afford, one pick per product.
 * Search mode: the listings furthest under their market price.
 * The budget is enforced by withinBudget, never by score.
 */
export function choosePicks(rows: ResultRow[], budget: number | null, n = 3): BudgetPick[] {
	const pool = (budget != null ? withinBudget(rows, budget) : rows).filter(pickable)
	if (budget != null) pool.sort((a, b) => b.score - a.score || a.total - b.total)
	else pool.sort((a, b) => discountVsMarket(b) - discountVsMarket(a) || a.total - b.total)
	const out: BudgetPick[] = []
	const seen = new Set<string>()
	for (const r of pool) {
		if (budget != null && seen.has(r.productId)) continue
		seen.add(r.productId)
		const p = PRODUCTS.get(r.productId)
		const why = [budget != null && p ? `najbolji uređaj u budžetu (${p.model}, ${p.year})` : null, rowWhy(r)].filter(Boolean).join(", ")
		out.push({ key: r.key, productId: r.productId, name: productName(r.productId), total: r.total, leftover: budget != null ? budget - r.total : 0, why })
		if (out.length === n) break
	}
	if (budget != null && out.some((p) => p.total > budget)) throw new Error("budget cap violated") // unreachable; belt and braces
	return out
}

/** Sell estimate from comparable rows (same product, condition group, storage when known). */
export function estimateSale(args: {
	productId: string | null
	condition: Condition
	storageGb: number | null
	text: string
	rows: ResultRow[]
}): SellEstimate {
	const { productId, condition, storageGb, text } = args
	const name = productId ? productName(productId) : null
	if (!productId) {
		return { productId, name, condition, storageGb, quick: null, patient: null, comps: [], draft: null, note: "Nisam prepoznao model. Napiši marku i model, npr. „iPhone 13 128GB polovan“." }
	}
	const comps = args.rows
		.filter((r) => r.productId === productId && conditionGroup(r.condition) === conditionGroup(condition) && r.flag !== "suspicious")
		.filter((r) => !storageGb || !r.storageGb || r.storageGb === storageGb)
		.sort((a, b) => a.price - b.price)
	const prices = comps.map((r) => r.price)
	const base = baselinePrice(productId, condition, storageGb)
	const round = (n: number | null) => (n == null ? null : Math.round(n / 500) * 500)
	const enough = prices.length >= 3
	const quick = round(enough ? percentile(prices, 0.25) : base && base * 0.92)
	const patient = round(enough ? percentile(prices, 0.6) : base)

	const battery = /baterij\w*\s*(\d{2,3})\s*%|(\d{2,3})\s*%\s*baterij/i.exec(text)
	const condWord = { sealed: "nov, zapakovan", new: "nov", used: "polovan, očuvan" }[condition]
	const title = [name, storageGb ? `${storageGb >= 1024 ? `${storageGb / 1024}TB` : `${storageGb}GB`}` : null, condWord].filter(Boolean).join(" ")
	const description = [
		`Prodajem ${name}${storageGb ? ` ${storageGb}GB` : ""}, ${condWord}.`,
		battery ? `Kapacitet baterije ${battery[1] ?? battery[2]}%.` : null,
		"Sve funkcije rade ispravno, nije zaključan (iCloud/Google nalog odjavljen).",
		"Lično preuzimanje ili slanje kurirskom službom.",
	]
		.filter(Boolean)
		.join("\n")

	return {
		productId,
		name,
		condition,
		storageGb,
		quick,
		patient,
		comps: comps.slice(0, 8).map((r) => ({ key: r.key, title: r.title, price: r.price, url: r.url })),
		draft: { title, description },
		note: enough
			? `Na osnovu ${prices.length} sličnih oglasa: brza prodaja oko donje četvrtine cena, strpljiva oko sredine.`
			: "Premalo sličnih oglasa, procena je na osnovu okvirne tržišne cene modela.",
	}
}
