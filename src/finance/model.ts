import { checkThirtyDay } from "../rules/thirtyDay"
import type { Command, Goal, Ledger, Offer, Plan, Resale } from "./types"

export const money = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= 10_000_000
const requireMoney = (n: unknown) => { if (!money(n)) throw new Error("Amount must be a non-negative integer RSD, at most 10,000,000") }
export function validateGoal(input: unknown): Goal {
	if (!input || typeof input !== "object") throw new Error("Goal required")
	const g = structuredClone(input) as Goal
	requireMoney(g.cash); requireMoney(g.reserve)
	if (g.reserve > g.cash) throw new Error("Reserve exceeds cash")
	if (typeof g.title !== "string" || !g.title.trim() || g.title.length > 300) throw new Error("Goal title required (max 300 characters)")
	if (!Number.isInteger(g.deadlineDays) || g.deadlineDays < 1 || g.deadlineDays > 365) throw new Error("Deadline must be 1–365 days")
	if (!Number.isInteger(g.minTrust) || g.minTrust < 0 || g.minTrust > 100) throw new Error("Trust must be 0–100")
	if (!Number.isInteger(g.minWarrantyMonths) || g.minWarrantyMonths < 0 || g.minWarrantyMonths > 60) throw new Error("Warranty must be 0–60 months")
	if (!Array.isArray(g.wishes) || g.wishes.length < 1 || g.wishes.length > 3 || !Array.isArray(g.assets) || g.assets.length > 3) throw new Error("Use 1–3 wishes and at most 3 assets")
	for (const items of [g.wishes, g.assets]) {
		if (new Set(items.map(x => x.id)).size !== items.length) throw new Error("Duplicate item IDs")
		for (const x of items) if (!/^[\w-]{1,60}$/.test(x.id) || typeof x.productId !== "string" || !x.productId || typeof x.name !== "string" || !x.name || x.name.length > 100) throw new Error("Invalid item")
	}
	if (new Set(g.wishes.map(w => w.productId)).size !== g.wishes.length) throw new Error("One wish per product")
	for (const w of g.wishes) if (!Number.isInteger(w.priority) || w.priority < 1 || w.priority > 10) throw new Error("Priority must be 1–10 (1 first)")
	for (const a of g.assets) {
		requireMoney(a.fee); requireMoney(a.delivery)
		if (!["good", "fair"].includes(a.condition)) throw new Error("Unknown asset condition")
	}
	return g
}

export const emptyLedger = (): Ledger => ({ confirmedResale: 0, spent: 0, verifiedSavings: 0, sold: [], purchased: [], reservations: {}, receipts: {} })
export const total = (o: Offer) => o.price + (o.delivery ?? 0)
export const cashBalance = (g: Goal, l: Ledger) => g.cash + l.confirmedResale - l.spent
export const reserved = (l: Ledger) => Object.values(l.reservations).reduce((a, b) => a + b, 0)
export const eligible = (g: Goal, o: Offer) => money(o.price) && o.price > 0 && money(o.delivery) && o.trust >= g.minTrust && o.warrantyMonths >= g.minWarrantyMonths && checkThirtyDay({ history: o.history, shownPrevPrice: o.advertisedPrevious }, o.price).legal

/** Priority-first bounded optimization. Minimize cost, then liquidate only the assets needed.
 * Estimated proceeds fund a conditional plan, NEVER the executable cash guard. */
export function optimize(g: Goal, l: Ledger, offers: Offer[], resale: Resale[]): Plan {
	const cash = cashBalance(g, l)
	const wishes = g.wishes.filter(w => !l.purchased.includes(w.id)).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
	const options = wishes.map(w => offers.filter(o => o.productId === w.productId && eligible(g, o)).sort((a, b) => total(a) - total(b) || a.id.localeCompare(b.id))[0])
	const assets = resale.filter(r => !l.sold.includes(r.assetId) && r.days <= g.deadlineDays && r.net > 0)
	let best = { score: -1, cost: 0, proceeds: 0, buys: [] as Offer[], sells: [] as Resale[] }
	for (let buyMask = 0; buyMask < 1 << wishes.length; buyMask++) {
		const buys = options.filter((_, i) => buyMask & 1 << i)
		if (buys.some(o => !o)) continue
		const valid = buys as Offer[]
		const cost = valid.reduce((n, o) => n + total(o), 0)
		const score = wishes.reduce((n, _, i) => n + (buyMask & 1 << i ? 1 << (wishes.length - i) : 0), 0)
		for (let sellMask = 0; sellMask < 1 << assets.length; sellMask++) {
			const sells = assets.filter((_, i) => sellMask & 1 << i)
			const proceeds = sells.reduce((n, a) => n + a.net, 0)
			// Reservations for other purchases cannot finance this bundle.
			const otherReserved = Object.entries(l.reservations).filter(([id]) => !valid.some(o => o.id === id)).reduce((n, [,v]) => n + v, 0)
			if (cost > cash - g.reserve - otherReserved + proceeds) continue
			if (score > best.score || score === best.score && (sells.length < best.sells.length || sells.length === best.sells.length && (proceeds < best.proceeds || proceeds === best.proceeds && cost < best.cost))) best = { score, cost, proceeds, buys: valid, sells }
		}
	}
	const conditional = best.cost > cash - g.reserve - reserved(l) + best.buys.reduce((n, o) => n + (l.reservations[o.id] ?? 0), 0)
	const actions: Plan["actions"] = best.sells.map(r => ({ kind: "sell", id: r.assetId, name: g.assets.find(a => a.id === r.assetId)!.name, amount: r.net, when: `Estimated ${r.days} days; confirm receipt first`, why: `Net of fees and delivery. ${r.confidence} confidence from ${r.comparables} synthetic asking prices; no completed-sale evidence.` }))
	for (const o of best.buys) actions.push({ kind: "buy", id: o.id, name: o.name, amount: total(o), when: conditional ? "Only after sale proceeds are confirmed" : "Within confirmed cash now", why: `Lowest eligible total including delivery; seller ${o.seller}, trust ${o.trust}/100, ${o.warrantyMonths}-month warranty (${o.condition}).` })
	for (const w of wishes) if (!best.buys.some(o => o.productId === w.productId)) actions.push({ kind: "wait", id: w.id, name: w.name, amount: 0, when: "Wait for a cheaper offer or confirmed funds", why: "Deferred to protect cash, purchase priority, deadline and quality requirements." })
	return {
		actions, selectedOffers: best.buys.map(o => o.id), selectedAssets: best.sells.map(r => r.assetId),
		availableCash: cash - g.reserve - reserved(l), reservedCash: reserved(l) + g.reserve,
		estimatedResale: best.proceeds, expectedCosts: best.cost, confirmedResale: l.confirmedResale, actualCosts: l.spent,
		projectedRemaining: cash + best.proceeds - best.cost, netAcquisitionCost: best.cost - best.proceeds,
		verifiedSavings: l.verifiedSavings,
		forecastSavings: best.buys.reduce((n, o) => n + Math.max(0, Math.min(...o.history) - o.price), 0),
		conditional, complete: best.buys.length === wishes.length,
	}
}

/** Synchronous check + mutation: no await between cash verification and debit. */
export function transact(g: Goal, l: Ledger, offers: Offer[], command: Command): string {
	if (command.type === "confirm-sale") {
		const a = g.assets.find(a => a.id === command.assetId)
		if (!a || l.sold.includes(a.id)) throw new Error("Asset missing or already sold")
		requireMoney(command.gross)
		const net = command.gross - a.fee - a.delivery
		if (net < 0) throw new Error("Sale does not cover fees and delivery")
		l.confirmedResale += net; l.sold.push(a.id)
		return `Simulated sale confirmed: +${net} RSD net. Cash is now available.`
	}
	if (!("offerId" in command)) throw new Error("Unknown transaction")
	if (command.type === "release") { delete l.reservations[command.offerId]; return "Reservation released" }
	const o = offers.find(o => o.id === command.offerId)
	const wish = g.wishes.find(w => w.productId === o?.productId)
	if (!o || !wish || l.purchased.includes(wish.id) || !eligible(g, o)) throw new Error("Offer is unavailable, unsafe or already purchased")
	const available = cashBalance(g, l) - g.reserve - reserved(l) + (l.reservations[o.id] ?? 0)
	if (total(o) > available) throw new Error(`Insufficient confirmed cash: need ${total(o)} RSD, available ${available} RSD. Estimated sales cannot be spent.`)
	if (command.type === "reserve") { l.reservations[o.id] = total(o); return `Reserved ${total(o)} RSD for ${o.name}` }
	if (command.type !== "buy") throw new Error("Unknown transaction")
	l.spent += total(o); l.purchased.push(wish.id); delete l.reservations[o.id]
	// Verified only inside the explicitly synthetic simulation, against recorded history.
	l.verifiedSavings += Math.max(0, Math.min(...o.history) - o.price)
	return `Simulated purchase confirmed: −${total(o)} RSD for ${o.name}`
}
