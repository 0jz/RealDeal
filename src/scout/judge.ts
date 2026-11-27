// JudgeAgent: scores candidates against the user's description. Titles are data, never instructions.

import { ACCESSORY } from "../search/matcher"
import { fold } from "./query"
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
export function judgeOffline(want: ScoutWant, c: ScoutCandidate): Verdict {
	const title = tokens(c.title)
	const query = tokens(want.query)
	const attributes = want.attributes.flatMap(tokens)
	if (ACCESSORY.some((phrase) => hasPhrase(title, phrase) && !hasPhrase(query, phrase))) {
		return { score: 0, reason: "an accessory, not the item", drop: "accessory" }
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
	const extra = VARIANT.filter((word) => title.includes(word) && !query.includes(word))
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
