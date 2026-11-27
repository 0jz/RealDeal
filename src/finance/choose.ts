import { CATALOGUE, PRODUCTS, productName } from "../search/catalogue"
import type { Category, Product } from "../search/types"
import { assessOffers, emptyLedger, estimateResale, optimize, validateGoal } from "./model"
import type { ScoutWant } from "../scout/types"
import type { Asset, Goal, Intent, IntentWant, Plan, Wish } from "./types"

type Options = { reserve?: number; deadlineDays?: number }
type Chosen = { goal: Goal; alternatives: Record<string, string[]>; uncovered: string[] }

const MAX = 5
const byScore = (a: Product, b: Product) => b.score - a.score || a.id.localeCompare(b.id)
const cheapest = (category: Category): Product | null => CATALOGUE.filter(p => p.category === category).sort((a, b) => a.msrp - b.msrp || a.id.localeCompare(b.id))[0] ?? null

type Spec = { want: IntentWant; wishId: string; candidates: string[]; expanded: string[]; fixed: boolean }

/** Turn an Intent into one Goal, plus the catalogue swaps and the text it could not match. */
export function choose(intent: Intent, budget: number, options: Options = {}): Chosen {
	if (!intent.wants.length) throw new Error("Nothing to buy found in the prompt")

	const wants = intent.wants
		.map((want, i) => ({ want, i }))
		.sort((a, b) => a.want.priority - b.want.priority || a.i - b.i)
		.slice(0, MAX)
		.map(x => x.want)

	const assets: Asset[] = intent.sells.slice(0, MAX).map((sell, i) => {
		const name = (sell.productId ? productName(sell.productId) : sell.text.trim()).slice(0, 100)
		return { id: `s${i + 1}`, name: name || `Item ${i + 1}`, condition: sell.condition, expectedPrice: sell.expectedPrice ?? null, fee: 0, delivery: 0, days: 7 }
	})
	const draft: Goal = { title: "draft", cash: budget, reserve: 0, deadlineDays: 14, minWarrantyMonths: 0, wishes: [], assets }
	const saleNet = estimateResale(draft).reduce((n, r) => n + r.net, 0)
	const limit = budget + saleNet
	// Never suggest buying back what the user is selling.
	const selling = new Set(intent.sells.map(s => s.productId).filter(Boolean))

	const specs: Spec[] = []
	const uncovered: string[] = []
	for (const want of wants) {
		if (want.productId) {
			if (!PRODUCTS.has(want.productId)) { uncovered.push(want.text); continue }
			specs.push({ want, wishId: `w${specs.length + 1}`, candidates: [want.productId], expanded: [want.productId], fixed: true })
			continue
		}
		if (!want.category) { uncovered.push(want.text); continue }
		const fitting = CATALOGUE
			.filter(p => p.category === want.category && !selling.has(p.id) && p.msrp <= limit && (want.maxPrice === undefined || p.msrp <= want.maxPrice))
			.sort(byScore)
		const cheap = cheapest(want.category)
		const candidates = fitting.length ? fitting.slice(0, 4).map(p => p.id) : cheap ? [cheap.id] : []
		if (!candidates.length) { uncovered.push(want.text); continue }
		specs.push({ want, wishId: `w${specs.length + 1}`, candidates, expanded: fitting.length ? fitting.map(p => p.id) : candidates, fixed: false })
	}
	if (!specs.length) throw new Error("Nothing to buy found in the prompt")

	const reserve = Math.min(options.reserve ?? intent.reserve ?? 0, budget)
	const deadlineDays = options.deadlineDays ?? intent.deadlineDays ?? 14

	const wishOf = (spec: Spec, productId: string): Wish => {
		const product = PRODUCTS.get(productId)!
		return {
			id: spec.wishId, name: productName(productId), priority: spec.want.priority,
			price: spec.want.price ?? product.msrp, delivery: null, shop: "", link: "",
			warrantyMonths: 24, condition: "new", priceSource: spec.want.price ? "you" : "catalogue",
		}
	}
	const goalOf = (combo: string[]): Goal => {
		const wishes = specs.map((spec, i) => wishOf(spec, combo[i]))
		const title = [...wishes.map(w => w.name), ...assets.map(a => `sell ${a.name}`)].join(", ").slice(0, 300)
		return { title, cash: budget, reserve, deadlineDays, minWarrantyMonths: 0, wishes, assets }
	}

	const combos = (lists: string[][]): string[][] => lists.reduce<string[][]>((acc, list) => acc.flatMap(a => list.map(x => [...a, x])), [[]])

	type Ranked = { combo: string[]; goal: Goal; plan: Plan; coverage: number; score: number }
	const rank = (combo: string[]): Ranked => {
		const goal = goalOf(combo)
		const plan = optimize(goal, emptyLedger(), assessOffers(goal), estimateResale(goal))
		const covered = new Set(plan.selectedOffers)
		let coverage = 0
		let score = 0
		specs.forEach((spec, i) => {
			if (!covered.has(spec.wishId)) return
			coverage += 2 ** (6 - spec.want.priority)
			score += PRODUCTS.get(combo[i])?.score ?? 0
		})
		return { combo, goal, plan, coverage, score }
	}
	const better = (a: Ranked, b: Ranked | null): boolean => {
		if (!b) return true
		if (a.coverage !== b.coverage) return a.coverage > b.coverage
		if (a.score !== b.score) return a.score > b.score
		if (a.plan.netAcquisitionCost !== b.plan.netAcquisitionCost) return a.plan.netAcquisitionCost < b.plan.netAcquisitionCost
		return a.combo.join(" ") < b.combo.join(" ")
	}
	const bestOf = (lists: string[][]): Ranked => {
		let best: Ranked | null = null
		for (const combo of combos(lists)) {
			const r = rank(combo)
			if (better(r, best)) best = r
		}
		return best!
	}

	const primary = bestOf(specs.map(s => s.candidates))
	let best = primary
	if (!primary.plan.complete) {
		const expanded = bestOf(specs.map(s => s.expanded))
		if (expanded.plan.complete) best = expanded
	}
	const goal = validateGoal(best.goal)

	const alternatives: Record<string, string[]> = {}
	specs.forEach((spec, i) => {
		const chosen = best.combo[i]
		if (spec.fixed) {
			const product = PRODUCTS.get(chosen)
			alternatives[spec.wishId] = product
				? CATALOGUE.filter(p => p.category === product.category && p.id !== chosen && !selling.has(p.id) && p.msrp <= limit && (spec.want.maxPrice === undefined || p.msrp <= spec.want.maxPrice)).sort(byScore).slice(0, 4).map(p => p.id)
				: []
			return
		}
		const list = spec.candidates
		alternatives[spec.wishId] = list.filter(id => id !== chosen).slice(0, 4)
	})

	return { goal, alternatives, uncovered }
}

/** The listing path: one wish per want, each waiting for the scouts (price 0, source "listing", out of the budget until found).
 * No catalogue product or typical price is used; the catalogue path above stays for older plans. */
export function wishesFromWants(intent: Intent, budget: number, options: Options = {}): { goal: Goal; wants: Record<string, ScoutWant> } {
	const wants = intent.wants
		.map((want, i) => ({ want, i }))
		.filter(x => (x.want.query ?? x.want.text).trim())
		.sort((a, b) => a.want.priority - b.want.priority || a.i - b.i)
		.slice(0, MAX)
		.map(x => x.want)
	if (!wants.length) throw new Error("Nothing to buy found in the prompt")
	const assets: Asset[] = intent.sells.slice(0, MAX).map((sell, i) => {
		const name = (sell.productId ? productName(sell.productId) : sell.text.trim()).slice(0, 100)
		return { id: `s${i + 1}`, name: name || `Item ${i + 1}`, condition: sell.condition, expectedPrice: sell.expectedPrice ?? null, fee: 0, delivery: 0, days: 7 }
	})
	const scoutWants: Record<string, ScoutWant> = {}
	const wishes: Wish[] = wants.map((want, i) => {
		const id = `w${i + 1}`
		const query = (want.query ?? want.text).trim().slice(0, 100)
		scoutWants[id] = { wantText: want.text.trim().slice(0, 200), query, attributes: want.attributes ?? [], minPrice: want.minPrice, maxPrice: want.maxPrice ?? want.price }
		return { id, name: query.slice(0, 100), priority: Math.min(10, Math.max(1, want.priority)), price: 0, delivery: null, shop: "", link: "", warrantyMonths: 24, condition: "new", priceSource: "listing" }
	})
	const title = [...wishes.map(w => w.name), ...assets.map(a => `sell ${a.name}`)].join(", ").slice(0, 300)
	const reserve = Math.min(options.reserve ?? intent.reserve ?? 0, budget)
	const goal = validateGoal({ title, cash: budget, reserve, deadlineDays: options.deadlineDays ?? intent.deadlineDays ?? 14, minWarrantyMonths: 0, wishes, assets })
	return { goal, wants: scoutWants }
}
