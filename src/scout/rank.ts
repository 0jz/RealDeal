import { matchTitle } from "../search/matcher"
import { PRODUCTS } from "../search/catalogue"
import type { DropReason, ScoutCandidate, ScoutListing, ScoutTrace, ScoutWant } from "./types"

export const MIN_SCORE = 0.6

/** Device quality for "best specs" ranking: the catalogue score plus a storage bonus. 0 when the title maps to no product. */
function specOf(title: string): number {
	const m = matchTitle(title)
	if (!m.productId) return 0
	const p = PRODUCTS.get(m.productId)
	if (!p) return 0
	let s = p.score
	if (p.storages?.[0] && m.storageGb && m.storageGb > p.storages[0]) s += 2 * Math.log2(m.storageGb / p.storages[0])
	return s
}

/** Scores this close to each other count as equal and fall back to price. */
const TIE = 0.05
const EPS = 1e-9
/** Listings of one product kept across all shops. */
const PER_PRODUCT = 2

type Judged = ScoutCandidate & { score: number; reason: string }

/** Deterministic range check; no range given → true. */
export function inRange(price: number, want: Pick<ScoutWant, "minPrice" | "maxPrice">): boolean {
	if (want.minPrice !== undefined && price < want.minPrice) return false
	if (want.maxPrice !== undefined && price > want.maxPrice) return false
	return true
}

/** Splits candidates into in-range and out-of-range traces. */
export function filterRange(cands: ScoutCandidate[], want: ScoutWant): { kept: ScoutCandidate[]; dropped: ScoutTrace[] } {
	const kept: ScoutCandidate[] = []
	const dropped: ScoutTrace[] = []
	for (const c of cands) {
		if (inRange(c.price, want)) {
			kept.push(c)
			continue
		}
		const why =
			want.maxPrice !== undefined && c.price > want.maxPrice
				? `${rsd(c.price)} RSD is over your ${rsd(want.maxPrice)} limit`
				: `${rsd(c.price)} RSD is under your ${rsd(want.minPrice ?? 0)} minimum`
		dropped.push({ ...c, score: null, kept: false, why, drop: "out of range" })
	}
	return { kept, dropped }
}

/** Orders judged candidates: score, then (bySpec ? device score : total price), then title. */
export function rank(judged: Judged[], opts: { bySpec?: boolean } = {}): { ordered: ScoutListing[]; dropped: ScoutTrace[] } {
	const dropped: ScoutTrace[] = []
	const scored: Judged[] = []
	for (const j of judged) {
		if (j.score < MIN_SCORE) dropped.push(trace(j, "low score", j.reason))
		else scored.push(j)
	}

	const urls = new Set<string>()
	const perProduct = new Map<string, number>()
	const ordered: ScoutListing[] = []
	for (const j of sortRanked(scored, opts.bySpec)) {
		if (urls.has(j.url)) {
			dropped.push(trace(j, "duplicate", "the same listing is already shown"))
			continue
		}
		const key = productKey(j.title)
		const count = perProduct.get(key) ?? 0
		if (count >= PER_PRODUCT) {
			dropped.push(trace(j, "duplicate", "2 listings of this product are already shown"))
			continue
		}
		urls.add(j.url)
		perProduct.set(key, count + 1)
		ordered.push(listing(j))
	}
	return { ordered, dropped }
}

/** best = ordered[0], next = places 2–3, mentions = places 4–10. Never pads. */
export function toSlots(ordered: ScoutListing[]): { best: ScoutListing | null; next: ScoutListing[]; mentions: ScoutListing[] } {
	return { best: ordered[0] ?? null, next: ordered.slice(1, 3), mentions: ordered.slice(3, 10) }
}

/** Score bands: a band starts at its highest score and holds everything within TIE of it. */
function sortRanked(items: Judged[], bySpec = false): Judged[] {
	const byScore = [...items].sort((a, b) => b.score - a.score)
	const out: Judged[] = []
	let band: Judged[] = []
	for (const j of byScore) {
		if (band.length && band[0].score - j.score > TIE + EPS) {
			out.push(...band.sort(bySpec ? bySpecThenTotal : byTotal))
			band = []
		}
		band.push(j)
	}
	return [...out, ...band.sort(bySpec ? bySpecThenTotal : byTotal)]
}

function bySpecThenTotal(a: Judged, b: Judged): number {
	const d = specOf(b.title) - specOf(a.title)
	if (d !== 0) return d
	return byTotal(a, b)
}

function byTotal(a: Judged, b: Judged): number {
	const d = total(a) - total(b)
	if (d !== 0) return d
	return a.title < b.title ? -1 : a.title > b.title ? 1 : 0
}

function total(c: ScoutCandidate): number {
	return c.price + (c.delivery ?? 0)
}

/** Lowercase, diacritics folded, đ → dj, other symbols collapsed to single spaces. */
function productKey(title: string): string {
	return title
		.toLowerCase()
		.replace(/đ/g, "dj")
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim()
}

function trace({ score, reason, ...candidate }: Judged, drop: DropReason, why: string): ScoutTrace {
	return { ...candidate, score, kept: false, why, drop }
}

function listing({ score, reason, ...candidate }: Judged): ScoutListing {
	return { ...candidate, score, reason, verified: false }
}

function rsd(n: number): string {
	return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".")
}
