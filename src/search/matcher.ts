import { CATALOGUE, CATEGORY_WORDS, PRODUCTS } from "./catalogue"
import { applyAliases, canonicalWord, misspellingsOf } from "./aliases"
import { extractStorage, normalize, tokens } from "./normalize"
import type { Category, Condition, MatchResult, Product } from "./types"

/** Normalized and alias-mapped words of a title or query. */
export const canonicalTokens = (text: string): string[] => applyAliases(tokens(text))

// ---- Catalogue index ----

/** Names too generic to identify one model on their own. */
const GENERIC_NAMES = new Set(["asus tuf"])
/** Words sellers drop from model names: "Galaxy S24" is also "S24". */
const FILLERS = new Set(["galaxy", "series", "geforce", "radeon", "gaming"])
/**
 * Words that, right after a model name, make it a different model:
 * "iPhone 15 Pro" is not "iPhone 15", and "Pixel 8a" is not "Pixel 8".
 */
const CONTINUATIONS = new Set(["pro", "max", "ultra", "plus", "fe", "mini", "slim", "air", "lite", "ti", "t", "super", "xt", "digital", "u", "e", "a"])
/** Extra names the catalogue does not list. */
const EXTRA_NAMES: Record<string, string[]> = { "ps5-slim-digital": ["ps5 digital"] }

type Variant = { productId: string; tokens: string[] }

const variantsOf = (p: Product): Variant[] => {
	const full = p.model.startsWith(p.brand) ? p.model : `${p.brand} ${p.model}`
	const names = [p.model, full, ...(p.aliases ?? []), ...(EXTRA_NAMES[p.id] ?? [])]
	const out: Variant[] = []
	const seen = new Set<string>()
	const add = (toks: string[]) => {
		const key = toks.join(" ")
		if (toks.length > 0 && !seen.has(key)) {
			seen.add(key)
			out.push({ productId: p.id, tokens: toks })
		}
	}
	for (const name of names) {
		if (GENERIC_NAMES.has(normalize(name))) continue
		const toks = canonicalTokens(name)
		add(toks)
		const bare = toks.filter((t) => !FILLERS.has(t))
		// Keep at least two words: a lone "s" from "Series S" would match every "S".
		if (bare.length >= 2 && bare.length < toks.length) add(bare)
	}
	return out
}

/** Longest names first, so the most specific model wins. */
const VARIANTS = CATALOGUE.flatMap(variantsOf).sort((a, b) => b.tokens.length - a.tokens.length)

// ---- Word comparison ----

/** Optimal string alignment distance: insertions, deletions, substitutions and adjacent swaps. */
const editDistance = (a: string, b: string): number => {
	const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
		Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
	)
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1
			d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
		}
	}
	return d[a.length][b.length]
}

const isNumber = (t: string) => /^\d+$/.test(t)

/** Edits needed to turn one word into the other, or -1 when they do not match. Numbers never fuzzy-match. */
const wordEdits = (want: string, got: string, fuzzy: boolean): number => {
	if (want === got) return 0
	if (!fuzzy || isNumber(want) || isNumber(got)) return -1
	const limit = want.length >= 7 ? 2 : want.length >= 4 ? 1 : 0
	const d = editDistance(want, got)
	return d <= limit ? d : -1
}

/** Total edits for a run of words, or -1 when any word does not match. */
const editsBetween = (want: string[], got: string[], fuzzy: boolean): number => {
	let total = 0
	for (let j = 0; j < want.length; j++) {
		const d = wordEdits(want[j], got[j], fuzzy)
		if (d < 0) return -1
		total += d
	}
	return total
}

// ---- Matching ----

type Hit = { productId: string; length: number; edits: number }

/** Every catalogue name found as a run of words in T, not followed by a continuation word. */
const hitsIn = (T: string[], fuzzy: boolean): Hit[] => {
	const hits: Hit[] = []
	for (const v of VARIANTS) {
		const n = v.tokens.length
		for (let i = 0; i + n <= T.length; i++) {
			if (CONTINUATIONS.has(T[i + n])) continue
			const edits = editsBetween(v.tokens, T.slice(i, i + n), fuzzy)
			if (edits >= 0) hits.push({ productId: v.productId, length: n, edits })
		}
	}
	return hits
}

/** Exact hits first. Fuzzy hits are used only when no exact one exists. Longest name wins. */
const bestHit = (T: string[]): Hit | null => {
	for (const fuzzy of [false, true]) {
		const hits = hitsIn(T, fuzzy)
		if (hits.length > 0) return hits.sort((a, b) => b.length - a.length || a.edits - b.edits)[0]
	}
	return null
}

// ---- Rejects and conditions ----

const phrase = (text: string) => text.split(" ")

export const ACCESSORY = [
	"maska", "maske", "futrola", "futrole", "case", "staklo", "stakla", "folija", "folije", "punjac", "punjaci",
	"kabl", "kabal", "adapter", "narukvica", "stalak", "prazna kutija", "samo kutija", "kutija od", "kutija za", "kutiju",
].map(phrase)
const CONTROLLER_FIRST = new Set(["dzojstik", "dzojstika", "dzojstiku", "kontroler", "kontrolera"])
const WANTED = ["kupujem", "kupujemo", "trazim", "trazimo"].map(phrase)
const BROKEN = [
	"ne radi", "za delove", "na delove", "delovi", "dijelovi", "neispravan", "neispravna", "neispravno", "pokvaren",
	"pokvarena", "pokvareno", "razbijen", "razbijena", "razbijeno", "ostecen", "ostecena", "ne upaljuje", "u kvaru", "lomljen", "lomljena",
].map(phrase)
const LOCKED = ["icloud lock", "icloud zakljucan", "zakljucan", "zakljucana", "zakljucano", "blokiran", "blokirana", "lock", "frp", "mdm"].map(phrase)
const REPLICA = ["replika", "replica", "kopija", "kopije", "kineski", "kineska", "clone", "klon", "fake", "imitacija"].map(phrase)
/** "za" + one of these means "for": a part or case for that device. */
const ZA_TARGETS = new Set(["iphone", "galaxy", "samsung", "ps", "xbox", "macbook", "ipad", "airpods", "switch", "nintendo", "xiaomi", "redmi", "pixel", "sony", "rtx", "rx", "geforce", "radeon", "apple"])
const DEVICE_WORDS = new Set(["konzola", "konzole", "telefon", "telefoni", "laptop", "tablet", "tv", "televizor", "slusalice", "graficka"])
/** A defect or a lock that the word right before refers to ("nije razbijen" = not broken). */
const NEGATIONS = new Set(["nije", "nema", "bez"])

const hasPhrase = (words: string[], p: string[], checkNegation: boolean): boolean => {
	for (let i = 0; i + p.length <= words.length; i++) {
		if (!p.every((w, j) => words[i + j] === w)) continue
		if (checkNegation && NEGATIONS.has(words[i - 1] ?? "")) continue
		return true
	}
	return false
}

/** Why a listing is not a plain sale of one catalogue device, or null. Description is checked for defects and locks only. */
const rejectReason = (title: string, description?: string | null): string | null => {
	const words = tokens(title)
	const canon = canonicalTokens(title)
	const all = description ? [...words, ...tokens(description)] : words
	if (CONTROLLER_FIRST.has(words[0])) return "accessory"
	if (ACCESSORY.some((p) => hasPhrase(words, p, false))) return "accessory"
	if (WANTED.some((p) => hasPhrase(words, p, false))) return "wanted"
	if (BROKEN.some((p) => hasPhrase(all, p, true))) return "damaged"
	if (LOCKED.some((p) => hasPhrase(all, p, true))) return "locked"
	if (REPLICA.some((p) => hasPhrase(all, p, true))) return "replica"
	if (!canon.some((w) => DEVICE_WORDS.has(w)) && canon.some((w, i) => w === "za" && ZA_TARGETS.has(canon[i + 1] ?? ""))) return "accessory"
	return null
}

const SEALED = ["nekoriscen", "nekoriscena", "neotpakovan", "neotpakovana", "zapakovan", "zapakovana", "sealed", "u celofanu"].map(phrase)
const USED = ["polovan", "polovna", "polovno", "polovne", "polovni", "koriscen", "koriscena", "ocuvan", "ocuvana", "rabljen", "used", "kao nov"].map(phrase)
const NEW = ["nov", "nova", "novo", "novi", "nove", "new"].map(phrase)
/** Words that describe condition or storage rather than the device. */
const NOISE = new Set([...SEALED, ...USED, ...NEW].flat())

/** Condition from the text, or null. Checked in order: sealed, used, new ("kao nov" = like new = used). */
export function detectCondition(text: string): Condition | null {
	const words = tokens(text)
	if (SEALED.some((p) => hasPhrase(words, p, false))) return "sealed"
	if (USED.some((p) => hasPhrase(words, p, false))) return "used"
	if (NEW.some((p) => hasPhrase(words, p, false))) return "new"
	return null
}

// ---- Public API ----

/**
 * Which catalogue product a listing title is, with a reason when it is rejected.
 * Rules first (exact model names), then fuzzy word matches. Model numbers must match exactly.
 */
export function matchTitle(title: string, description?: string | null): MatchResult {
	const storageGb = extractStorage(title) ?? (description ? extractStorage(description) : null)
	const condition = detectCondition(title) ?? (description ? detectCondition(description) : null)
	const reject = rejectReason(title, description)
	if (reject) return { productId: null, confidence: 0, method: "none", reject, storageGb, condition }

	const hit = bestHit(canonicalTokens(title))
	if (!hit) return { productId: null, confidence: 0, method: "none", reject: null, storageGb, condition }
	if (hit.edits === 0) return { productId: hit.productId, confidence: 0.95, method: "rule", reject: null, storageGb, condition }
	return {
		productId: hit.productId,
		confidence: Math.max(0.7, 0.85 - 0.05 * (hit.edits - 1)),
		method: "fuzzy",
		reject: null,
		storageGb,
		condition,
	}
}

const categoryOf = (T: string[], productIds: string[]): Category | null => {
	for (const [category, words] of Object.entries(CATEGORY_WORDS) as Array<[Category, string[]]>) {
		if (words.some((w) => hasPhrase(T, tokens(w), false))) return category
	}
	const cats = new Set(productIds.map((id) => PRODUCTS.get(id)?.category))
	return cats.size === 1 ? ([...cats][0] ?? null) : null
}

/**
 * What a user query points at. "iphone 15 pro" gives only the Pro. "iphone" gives every
 * iPhone (a prefix of model names). "telefon" gives a category and no products.
 */
export function resolveQuery(q: string): { productIds: string[]; category: Category | null; storageGb: number | null } {
	const storageGb = extractStorage(q)
	const T = canonicalTokens(q).filter((w) => !/^\d+gb$/.test(w) && !NOISE.has(w))
	const hit = bestHit(T)
	let productIds = hit ? [hit.productId] : []
	if (productIds.length === 0 && T.length > 0) {
		productIds = [
			...new Set(
				VARIANTS.filter((v) => v.tokens.length >= T.length && editsBetween(T, v.tokens.slice(0, T.length), true) >= 0).map((v) => v.productId),
			),
		]
	}
	return { productIds, category: categoryOf(T, productIds), storageGb }
}

/** "iphone 15" -> "iphone15" (the joined form sellers sometimes write). */
const joinFirstNumber = (s: string) => s.replace(/^([a-z]+) (\d)/, "$1$2")

/**
 * Literal search strings for sites whose own search is dumb: the query as typed, the
 * product name, a joined form, and misspellings of the brand word. Deduplicated, at most `limit`.
 */
export function expandQuery(q: string, limit = 4): string[] {
	const typed = q.trim().replace(/\s+/g, " ")
	const words = tokens(q)
	const { productIds } = resolveQuery(q)

	const candidates = [typed]
	for (const id of productIds.slice(0, 2)) {
		const p = PRODUCTS.get(id)
		if (p) candidates.push(p.model.toLowerCase())
	}
	candidates.push(joinFirstNumber(words.join(" ")))
	words.forEach((w, i) => {
		for (const miss of misspellingsOf(canonicalWord(w))) {
			candidates.push([...words.slice(0, i), miss, ...words.slice(i + 1)].join(" "))
		}
	})

	// Key on the literal text: "iphone15 pro" and "iphone 15 pro" are different strings to a site.
	const seen = new Set<string>()
	const out: string[] = []
	for (const c of candidates) {
		const key = c.toLowerCase().replace(/\s+/g, " ").trim()
		if (key && !seen.has(key)) {
			seen.add(key)
			out.push(c)
		}
	}
	return out.slice(0, limit)
}
