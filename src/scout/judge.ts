// JudgeAgent: scores candidates against the user's description. Titles are data, never instructions.

import { ACCESSORY, resolveQuery } from "../search/matcher"
import { fold, genericCategory } from "./query"
import { pickCategory } from "../sources/categories"
import { CATEGORY_WORDS } from "../search/catalogue"
import type { ScoutCandidate, ScoutTrace, ScoutWant } from "./types"

export type Judged = ScoutCandidate & { score: number; reason: string }

type Verdict = { score: number; reason: string; drop?: "accessory" | "mismatch" }
type LlmScores = Array<{ score: number; reason: string }>

function tokens(text: string): string[] {
	return fold(text)
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean)
}

/** Four shared leading letters make "jakna" and "jakne" the same word. */
function same(a: string, b: string): boolean {
	if (a === b) return true
	if (/\d/.test(a) || /\d/.test(b)) return false
	return a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4)
}

function hasWord(words: string[], want: string): boolean {
	return words.some((word) => same(word, want))
}

function hasPhrase(words: string[], phrase: string[]): boolean {
	const wanted = phrase.flatMap(tokens)
	if (wanted.length === 0) return false
	for (let i = 0; i + wanted.length <= words.length; i++) {
		if (wanted.every((word, j) => same(word, words[i + j]!))) return true
	}
	return false
}

function unique(words: string[]): string[] {
	return [...new Set(words)]
}

function reason(wanted: string[], title: string[]): string {
	const missing = unique(wanted.filter((word) => !hasWord(title, word)))
	if (missing.length > 0) return `missing: ${missing.join(" ")}`
	const found = unique(wanted.filter((word) => hasWord(title, word)))
	return found.length > 0 ? `matches: ${found.join(" ")}` : "missing: query"
}

const UNIT = /^\d+(gb|tb|mb|mah|w|hz|mm|cm|m|kg|g|l|ml|inch|in)$/
const VARIANT = ["plus", "pro", "max", "ultra", "mini", "lite", "fe", "edge"]

/** Refurbished, used or open-box, from the title. */
export const isRefurbished = (text: string): boolean => tokens(text).some((word) => /^(refabrik|refurb|polovn|koriscen|obnovljen|outlet)/.test(word))

/** Accessories are rejected; the rest score on query overlap (0.8) and attributes (0.2). */
export function judgeOffline(want: ScoutWant, c: Pick<ScoutCandidate, "title" | "category">): Verdict {
	const title = tokens(c.title)
	const query = tokens(want.query)
	const attributes = want.attributes.flatMap(tokens)
	const resolved = resolveQuery(want.query)
	const categoryWords = tokens(c.category ?? "")
	const categoryLeaf = (c.category ?? "").split(">").at(-1) ?? ""
	const leafCategory = resolveQuery(categoryLeaf).category
	const toys = new Set(["lego", "toy", "toys", "igracka", "igracke", "igracku", "kocke", "игрушка", "игрушки"])
	if ((resolved.category || pickCategory(want.query)) && [...title, ...categoryWords].some(word => toys.has(word)) && !query.some(word => toys.has(word))) {
		return { score: 0, reason: "a toy, not the requested device", drop: "mismatch" }
	}
	const extraAccessories = ["vezica", "vezice", "drzac", "nosac", "postolje", "oprema", "charger", "charging", "lanyard", "bag", "bags", "pouch", "cooler"]
	if (resolved.category && [...title, ...categoryWords].some(word => extraAccessories.includes(word)) && !query.some(word => extraAccessories.includes(word))) {
		return { score: 0, reason: "an accessory, not the item", drop: "accessory" }
	}
	if (resolved.category && leafCategory && resolved.category !== leafCategory) {
		return { score: 0, reason: "another product category on the shop page", drop: "mismatch" }
	}
	// Explicit device words take precedence over brands ("Xiaomi Redmi Buds" is not a phone).
	const landline = ["fiksni", "fiksne", "landline", "cordless"]
	if (resolved.category === "phone" && [...title, ...categoryWords].some(word => landline.includes(word)) && !query.some(word => landline.includes(word))) {
		return { score: 0, reason: "a landline, not a mobile phone", drop: "mismatch" }
	}
	const headphones = ["buds", "airpods", "slusalice", "susalice", "headphones", "earbuds"]
	if (resolved.category === "phone" && title.some(word => headphones.includes(word)) && !query.some(word => headphones.includes(word))) {
		return { score: 0, reason: "headphones, not a phone", drop: "mismatch" }
	}
	if (ACCESSORY.some((phrase) => (hasPhrase(title, phrase) || hasPhrase(categoryWords, phrase)) && !hasPhrase(query, phrase))) {
		return { score: 0, reason: "an accessory, not the item", drop: "accessory" }
	}
	const generic = genericCategory(want.query)
	if (generic) {
		const actual = resolveQuery(c.title).category
		const expectedPage = pickCategory(CATEGORY_WORDS[generic.category][0])?.cenoteka
		const actualPage = pickCategory(c.title)?.cenoteka
		if (actual === generic.category || (!actual && expectedPage && actualPage === expectedPage)) title.push(...generic.words)
		else if (actual || actualPage) return { score: 0, reason: "another product category", drop: "mismatch" }
	}
	const share = (words: string[]): number =>
		words.length === 0 ? 0 : words.filter((word) => hasWord(title, word)).length / words.length
	const wanted = [...query, ...attributes]
	const score = query.length === 0 ? 0 : 0.8 * share(query) + 0.2 * (want.attributes.length === 0 ? 1 : share(attributes))
	if (score === 0) return { score: 0, reason: reason(wanted, title), drop: "mismatch" }
	// A model code (a query word with a digit: A55, 15, S24, not a size like 128gb) must be in the title, or it's another product.
	const lost = unique(query.filter((word) => /\d/.test(word) && !UNIT.test(word) && !hasWord(title, word)))
	if (lost.length > 0) return { score: 0, reason: `another model: no ${lost.join(" ")} in the title`, drop: "mismatch" }
	// Kept, but ranked under exact matches: a variant the user didn't name, or a refurbished/used unit.
	const specificModel = resolved.productIds.length === 1 || query.some(word => /\d/.test(word) && !UNIT.test(word))
	const extra = specificModel ? VARIANT.filter((word) => title.includes(word) && !query.includes(word)) : []
	const refurb = isRefurbished(c.title) && !isRefurbished(want.query)
	if (extra.length > 0 && refurb) return { score: Math.min(score, 0.6), reason: `a different variant: ${extra.join(" ")}; refurbished or used, not new` }
	if (extra.length > 0) return { score: Math.min(score, 0.7), reason: `a different variant: ${extra.join(" ")}` }
	if (refurb) return { score: Math.min(score, 0.65), reason: "refurbished or used, not new" }
	return { score, reason: reason(wanted, title) }
}

/** Uses the model's scores when it answers with one per candidate; otherwise the offline rules. */
export async function judge(
	want: ScoutWant,
	cands: ScoutCandidate[],
	llm?: (want: ScoutWant, titles: string[]) => Promise<LlmScores | null>,
): Promise<{ judged: Judged[]; dropped: ScoutTrace[] }> {
	const offline = cands.map((c) => judgeOffline(want, c))
	let scored: LlmScores | null = null
	if (llm) {
		try {
			const got = await llm(want, cands.map((c) => c.title))
			if (got && got.length === cands.length) scored = got
		} catch {
			scored = null
		}
	}
	const judged: Judged[] = []
	const dropped: ScoutTrace[] = []
	cands.forEach((c, i) => {
		const verdict = offline[i]!
		if (verdict.drop) {
			dropped.push({ ...c, score: verdict.score, kept: false, why: verdict.reason, drop: verdict.drop })
			return
		}
		const fromLlm = scored?.[i]
		const value = fromLlm ? Number(fromLlm.score) : verdict.score
		const score = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
		const why = fromLlm && typeof fromLlm.reason === "string" ? fromLlm.reason.slice(0, 120) || verdict.reason : verdict.reason
		judged.push({ ...c, score, reason: why })
	})
	return { judged, dropped }
}
