import { PRODUCTS } from "../search/catalogue"
import { canonicalTokens, resolveQuery } from "../search/matcher"
import type { Intent, IntentSell, IntentWant } from "./types"

export const MAX_PROMPT = 1000

const fold = (s: string) =>
	s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "dj")

/** Clauses split on punctuation between non-digits, and on the words "i" / "and". */
const CLAUSE_SPLIT = /(?<!\d)[.,;!?]|[.,;!?](?!\d)|\s+[aA][nN][dD]\s+|\s+i\s+/g

const SELL = /\b(sell|selling|prodajem|prodam|prodati)\b|\bimam star[ui]\b|\bmy old\b/
const BUDGET = /\b(imam|have|budget|budzet|ukupno)\b/
const PRICE_PREP = /\b(za|for|at|po)\b/
const FAIR = /\b(fair|worn|scratched|scratches|damaged|ostecen[a-z]*|izgreban[a-z]*|los[a-z]*)\b/
const CONDITION = /\b(good|great|fine|ok|dobro|dobrom|dobra|odlican|odlicna|odlicno|super|fair|worn|scratched|scratches|damaged|ostecen[a-z]*|izgreban[a-z]*|los[a-z]*)\b/

const FILLER = new Set([
	"hocu", "zelim", "zelio", "zeleo", "zelimo", "treba", "mi", "bih", "bi",
	"want", "wanna", "need", "would", "like", "please", "molim", "i", "a", "an", "the",
	"to", "can", "could", "you", "me", "my", "some", "just", "also", "only", "new",
	"polovan", "polovna", "polovno", "used",
])

const PRICE =
	/(?<![a-z0-9])(\d{1,3}(?:[.,]\d{3})+|\d{1,3}(?:[ \u00a0]\d{3})+(?=\s*(?:rsd|din|k|hiljad))|\d+)(?:\s*(k|hiljad[a-z]*|rsd|din[a-z]*))?(?![a-z0-9])/gi

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const productNames = (id: string): string[] => {
	const p = PRODUCTS.get(id)
	if (!p) return []
	return [p.model, `${p.brand} ${p.model}`, ...(p.aliases ?? [])]
}

/** Blank out model numbers (e.g. the 4060 in "RTX 4060") so they are not read as money. */
const maskModelNumbers = (s: string, id?: string): string => {
	if (!id) return s
	const nums = new Set<string>()
	for (const name of productNames(id)) for (const t of canonicalTokens(name)) if (/^\d+$/.test(t)) nums.add(t)
	let out = s
	for (const n of nums) out = out.replace(new RegExp(`(?<![a-z0-9])(?<!\\d[.,])${escapeRe(n)}(?![a-z0-9])(?![.,]\\d)`, "g"), " ")
	return out
}

const parsePrices = (s: string): number[] => {
	const out: number[] = []
	for (const m of s.matchAll(PRICE)) {
		const raw = m[1]
		const unit = (m[2] ?? "").toLowerCase()
		let n = Number(raw.replace(/[.,\s\u00a0]/g, ""))
		if (!Number.isSafeInteger(n)) continue
		if (unit === "k" || unit.startsWith("hiljad")) n *= 1000
		else if (!unit && n < 1000) continue
		if (!Number.isSafeInteger(n) || n <= 0) continue
		out.push(n)
	}
	return out
}

export function parsePrompt(text: string): { intent: Intent; unknown: string[] } {
	if (typeof text !== "string") throw new Error("Prompt must be text")
	const raw = text.trim()
	if (!raw) throw new Error("Prompt is empty")
	if (text.length > MAX_PROMPT) throw new Error(`Prompt is too long (max ${MAX_PROMPT} characters)`)

	const wants: IntentWant[] = []
	const sells: IntentSell[] = []
	const unknown: string[] = []
	let budget: number | undefined
	let budgetStated = false
	let lastSell: IntentSell | null = null

	const clauses = raw.split(CLAUSE_SPLIT).map((c) => c.trim()).filter(Boolean)
	for (const clause of clauses) {
		const folded = fold(clause)
		const { productIds, category } = resolveQuery(clause)
		const productId = productIds.length === 1 ? productIds[0] : undefined
		const hasTarget = Boolean(productId || category)
		const isSell = SELL.test(folded)
		const fair = FAIR.test(folded)
		const isConditionOnly = !hasTarget && CONDITION.test(folded)
		const prices = parsePrices(maskModelNumbers(folded, productId))

		if (isConditionOnly) {
			if (lastSell) lastSell.condition = fair ? "fair" : "good"
			else unknown.push(clause)
			continue
		}

		if (isSell) {
			const sell: IntentSell = { text: clause, productId, condition: fair ? "fair" : "good" }
			if (prices.length > 0) sell.expectedPrice = prices[0]
			if (sells.length < 5) {
				sells.push(sell)
				lastSell = sell
			} else unknown.push(clause)
			continue
		}

		if (hasTarget) {
			const want: IntentWant = { text: clause, priority: wants.length + 1 }
			if (productId) want.productId = productId
			if (category) want.category = category
			if (BUDGET.test(folded)) {
				budgetStated = true
				if (budget === undefined && prices.length > 0) budget = prices[0]
			} else if (prices.length > 0) {
				if (productId) {
					if (PRICE_PREP.test(folded)) want.price = prices[0]
				} else if (category) want.maxPrice = prices[0]
			}
			if (wants.length < 5) wants.push(want)
			else unknown.push(clause)
			continue
		}

		if (BUDGET.test(folded)) {
			budgetStated = true
			if (budget === undefined && prices.length > 0) budget = prices[0]
			continue
		}

		if (prices.length > 0) continue

		const words = folded.split(/[^a-z0-9]+/).filter(Boolean)
		if (words.length > 0 && words.every((w) => FILLER.has(w))) continue
		unknown.push(clause)
	}

	if (!budgetStated) {
		const sum = wants.reduce((n, w) => n + (w.price ?? w.maxPrice ?? 0), 0)
		if (sum > 0) budget = sum
	}

	const intent: Intent = { wants, sells }
	if (budget !== undefined) intent.budget = budget
	return { intent, unknown }
}
