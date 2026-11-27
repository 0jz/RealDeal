import { PRODUCTS } from "../search/catalogue"
import { canonicalTokens, resolveQuery } from "../search/matcher"
import type { Intent, IntentSell, IntentWant } from "./types"

export const MAX_PROMPT = 1000

const fold = (s: string) =>
	s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "dj")

/** Clauses split on punctuation between non-digits, and on "i" / "and", but not inside "između 50 i 80k". */
const CLAUSE_SPLIT = /(?<!\d)[.,;!?]|[.,;!?](?!\d)|(?<!(?:[iI]zme[dđ]j?u|[bB]etween)\s+\S+)\s+(?:[aA][nN][dD]|i)\s+/g

const SELL = /\b(sell|selling|prodajem|prodam|prodati)\b|\bimam star[ui]\b|\bmy old\b/
const BUDGET = /\b(imam|have|budget|budzet|ukupno)\b/
const PRICE_PREP = /\b(za|for|at|po)\b/
const FAIR = /\b(fair|worn|scratched|scratches|damaged|ostecen[a-z]*|izgreban[a-z]*|los[a-z]*)\b/
const CONDITION = /\b(good|great|fine|ok|dobro|dobrom|dobra|odlican|odlicna|odlicno|super|fair|worn|scratched|scratches|damaged|ostecen[a-z]*|izgreban[a-z]*|los[a-z]*)\b/
/** Words that say the user wants to buy something. */
const BUY = /\b(?:ho[cć]u|[zž]elim|treba\s+mi|trebam|kupiti|kupio\s+bih|want|need|buy|looking\s+for|tra[zž]im)\b/gi

const FILLER = new Set([
	"hocu", "zelim", "zelio", "zeleo", "zelimo", "treba", "mi", "bih", "bi",
	"want", "wanna", "need", "would", "like", "please", "molim", "i", "a", "an", "the",
	"to", "can", "could", "you", "me", "my", "some", "just", "also", "only", "new",
	"polovan", "polovna", "polovno", "used",
])
const CURRENCY = new Set(["rsd", "din", "dinara", "dinar", "dinare", "eur", "euro", "evra"])

const SR_COLOURS: [string, string][] = [
	["crn", "black"], ["bel", "white"], ["plav", "blue"], ["crven", "red"], ["zelen", "green"],
	["siv", "grey"], ["braon", "brown"], ["roze", "pink"], ["zut", "yellow"],
]
const EN_COLOURS = new Set(["black", "white", "blue", "red", "green", "grey", "gray", "brown", "pink", "yellow"])
const NEW_WORDS = new Set(["nov", "nova", "novo", "novu", "novi", "nove", "new"])
const USED_WORDS = new Set(["polovan", "polovna", "polovno", "polovnu", "polovni", "polovne", "used"])
const NEW_OR_USED = new Set([...NEW_WORDS, ...USED_WORDS])

const PRICE =
	/(?<![a-z0-9])(\d{1,3}(?:[.,]\d{3})+|\d{1,3}(?:[  ]\d{3})+(?=\s*(?:rsd|din|k|hiljad))|\d+)(?:\s*(k|hiljad[a-z]*|rsd|din[a-z]*))?(?![a-z0-9])/gi

// Range pieces: a number, an optional unit (k, hiljada, rsd, din), and a word boundary after it.
const NUM = String.raw`(\d+(?:[.,]\d{3})*)`
const UNIT = String.raw`(?:\s*(k|hiljad[a-z]*|rsd|din[a-z]*))?`
const END = String.raw`(?![a-z0-9])`
const SEP = String.raw`\s*(?:-|–|\bi\b|\band\b)\s*`
const rx = (src: string) => new RegExp(src, "gi")

type Range = { min?: number; max?: number }
type RangeRule = { re: RegExp; read: (m: RegExpMatchArray) => Range | null }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const productNames = (id: string): string[] => {
	const p = PRODUCTS.get(id)
	if (!p) return []
	return [p.model, `${p.brand} ${p.model}`, ...(p.aliases ?? [])]
}

/** Blank out model numbers (e.g. the 4060 in "RTX 4060") so they are not read as money. Same length as the input. */
const maskModelNumbers = (s: string, id?: string): string => {
	if (!id) return s
	const nums = new Set<string>()
	for (const name of productNames(id)) for (const t of canonicalTokens(name)) if (/^\d+$/.test(t)) nums.add(t)
	let out = s
	for (const n of nums) {
		const re = new RegExp(`(?<![a-z0-9])(?<!\\d[.,])${escapeRe(n)}(?![a-z0-9])(?![.,]\\d)`, "gi")
		out = out.replace(re, (m) => " ".repeat(m.length))
	}
	return out
}

const blank = (s: string, start: number, end: number) => s.slice(0, start) + " ".repeat(end - start) + s.slice(end)

/** Integer RSD from a number and its unit, or null when it cannot be a price ("85" alone is not one). */
const amount = (raw: string, unit = ""): number | null => {
	const u = unit.toLowerCase()
	const n = Number(raw.replace(/[.,\s ]/g, ""))
	const value = u === "k" || u.startsWith("hiljad") ? n * 1000 : n
	if (!Number.isSafeInteger(value) || value <= 0) return null
	if (!u && value < 1000) return null
	return value
}

/** A number is money unless it is a size, a storage or battery figure, a frequency or a power rating. */
const NOT_MONEY_BEFORE = /(?:broj|size|veli[cč]ina)\s*$/i
const NOT_MONEY_AFTER = /^\s*(?:gb|tb|mah|hz|w(?![a-z])|inch|in[cč]a|")/i
const isMoney = (text: string, start: number, end: number) =>
	!NOT_MONEY_BEFORE.test(text.slice(0, start)) && !NOT_MONEY_AFTER.test(text.slice(end))

/** Every price in text, with the span it covers (a "za" or "for" right before it included). */
const priceSpans = (text: string): { value: number; start: number; end: number }[] => {
	const out: { value: number; start: number; end: number }[] = []
	for (const m of text.matchAll(PRICE)) {
		const start = m.index ?? 0
		const end = start + m[0].length
		const value = amount(m[1].replace(/\s/g, ""), m[2])
		if (value === null || !isMoney(text, start, end)) continue
		const prep = /\b(?:za|for|at|po)\s+$/i.exec(text.slice(0, start))
		out.push({ value, start: prep ? start - prep[0].length : start, end })
	}
	return out
}

const parsePrices = (s: string): number[] => priceSpans(s).map((p) => p.value)

const pair = (a: string, ua: string | undefined, b: string, ub: string | undefined): Range | null => {
	if (!ua && !ub) return null
	const x = amount(a, ua || ub)
	const y = amount(b, ub || ua)
	if (x === null || y === null) return null
	return { min: Math.min(x, y), max: Math.max(x, y) }
}

const single = (m: RegExpMatchArray) => amount(m[1], m[2])

const RANGE_RULES: RangeRule[] = [
	{
		re: rx(String.raw`\b(?:izme[dđ]j?u|between)\s+${NUM}${UNIT}${SEP}${NUM}${UNIT}${END}`),
		read: (m) => pair(m[1], m[2], m[3], m[4]),
	},
	{
		re: rx(String.raw`(?<![a-z0-9])${NUM}${UNIT}\s*[-–]\s*${NUM}${UNIT}${END}`),
		read: (m) => pair(m[1], m[2], m[3], m[4]),
	},
	{
		re: rx(String.raw`\b(?:ispod|najvi[sš]e|maks(?:imalno)?|max|do|under)\s+${NUM}${UNIT}${END}`),
		read: (m) => {
			const v = single(m)
			return v === null ? null : { max: v }
		},
	},
	{
		re: rx(String.raw`\b(?:od|preko|over|min|najmanje)\s+${NUM}${UNIT}${END}`),
		read: (m) => {
			const v = single(m)
			return v === null ? null : { min: v }
		},
	},
	{
		re: rx(String.raw`(?:\b(?:oko|around)\s+|~\s*)${NUM}${UNIT}${END}`),
		read: (m) => {
			const v = single(m)
			return v === null ? null : { min: Math.round(v * 0.8), max: Math.round(v * 1.2) }
		},
	},
]

/** Range phrases in a clause. Returns the range and the clause with those phrases blanked out. */
const takeRanges = (clause: string, productId?: string) => {
	let text = maskModelNumbers(clause, productId)
	let kept = clause
	const range: Range = {}
	for (const { re, read } of RANGE_RULES) {
		for (const m of text.matchAll(re)) {
			const start = m.index ?? 0
			const end = start + m[0].length
			const r = read(m)
			if (!r || !isMoney(text, start, end)) continue
			range.min ??= r.min
			range.max ??= r.max
			text = blank(text, start, end)
			kept = blank(kept, start, end)
		}
	}
	return { range, text, kept }
}

/** The want text without buy words, currency and filler. Attribute words stay. */
const cleanQuery = (kept: string): string =>
	kept
		.replace(BUY, " ")
		.split(/\s+/)
		.filter((w) => {
			const f = fold(w).replace(/[^a-z0-9]/g, "")
			return f !== "" && !CURRENCY.has(f) && !(FILLER.has(f) && !NEW_OR_USED.has(f))
		})
		.join(" ")

/** Size, storage, colour and condition words the user wrote. */
const attributesOf = (clause: string): string[] => {
	const f = fold(clause)
	const out = new Set<string>()
	for (const m of f.matchAll(/\b(?:size|velicina)\s+(xxxl|xxl|xl|xs|s|m|l|\d{1,2})\b/g)) out.add(`size ${m[1].toUpperCase()}`)
	for (const m of f.matchAll(/\bbroj\s+(\d{2})\b/g)) out.add(`size ${m[1]}`)
	for (const m of f.matchAll(/\b(\d{1,4})\s?(gb|tb)\b/g)) out.add(`${m[1]}${m[2].toUpperCase()}`)
	for (const w of f.split(/[^a-z0-9]+/)) {
		if (EN_COLOURS.has(w)) out.add(w)
		const colour = SR_COLOURS.find(([stem]) => w.startsWith(stem))
		if (colour) out.add(colour[1])
		if (NEW_WORDS.has(w)) out.add("new")
		if (USED_WORDS.has(w)) out.add("used")
	}
	return [...out]
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
		const prices = parsePrices(maskModelNumbers(clause, productId))

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

		if (!hasTarget && BUDGET.test(folded)) {
			budgetStated = true
			if (budget === undefined && prices.length > 0) budget = prices[0]
			continue
		}

		const { range, text, kept } = takeRanges(clause, productId)
		const generic = priceSpans(text)
		const query = cleanQuery(generic.reduce((s, p) => blank(s, p.start, p.end), kept))
		const hasSignal = range.min !== undefined || range.max !== undefined || generic.length > 0 || clause.search(BUY) >= 0

		if (hasTarget || (hasSignal && query !== "")) {
			const want: IntentWant = {
				text: clause, priority: wants.length + 1, query: query || clause, attributes: attributesOf(clause),
			}
			if (productId) want.productId = productId
			if (category) want.category = category
			if (range.min !== undefined) want.minPrice = range.min
			if (range.max !== undefined) want.maxPrice = range.max
			if (BUDGET.test(folded)) {
				budgetStated = true
				if (budget === undefined && prices.length > 0) budget = prices[0]
			} else if (generic.length > 0) {
				const price = generic[0].value
				if (productId && PRICE_PREP.test(folded)) want.price = price
				if (want.maxPrice === undefined) want.maxPrice = price
			}
			if (wants.length < 5) wants.push(want)
			else unknown.push(clause)
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
