import { PRODUCTS } from "../search/catalogue"
import { resolveQuery } from "../search/matcher"
import type { Command, Goal, Ledger, Offer, Plan, Resale } from "./types"

export const money = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= 10_000_000
const requireMoney = (n: unknown, what = "Amount") => { if (!money(n)) throw new Error(`${what} must be a whole number of RSD between 0 and 10,000,000`) }
const int = (n: unknown, lo: number, hi: number) => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi
const text = (s: unknown, max: number) => typeof s === "string" && s.length <= max

export const MAX_WISHES = 5
export const MAX_ASSETS = 5

export function validateGoal(input: unknown): Goal {
	if (!input || typeof input !== "object") throw new Error("Goal required")
	const g = structuredClone(input) as Goal
	requireMoney(g.cash, "Cash"); requireMoney(g.reserve, "Reserve")
	if (g.reserve > g.cash) throw new Error("Reserve can't be more than your cash")
	if (!text(g.title, 300)) throw new Error("Title is too long (max 300 characters)")
	g.title = g.title.trim()
	if (!int(g.deadlineDays, 1, 365)) throw new Error("Deadline must be 1–365 days")
	if (!int(g.minWarrantyMonths, 0, 60)) throw new Error("Minimum warranty must be 0–60 months")
	if (!Array.isArray(g.wishes) || g.wishes.length < 1 || g.wishes.length > MAX_WISHES) throw new Error(`Add 1–${MAX_WISHES} things to buy`)
	if (!Array.isArray(g.assets) || g.assets.length > MAX_ASSETS) throw new Error(`Add at most ${MAX_ASSETS} things to sell`)
	const ids = [...g.wishes, ...g.assets].map(x => x?.id)
	if (new Set(ids).size !== ids.length) throw new Error("Duplicate item IDs")
	for (const x of [...g.wishes, ...g.assets]) {
		if (!x || typeof x !== "object" || typeof x.id !== "string" || !/^[\w-]{1,60}$/.test(x.id)) throw new Error("Invalid item")
		if (!text(x.name, 100) || !x.name.trim()) throw new Error("Every item needs a name (max 100 characters)")
		x.name = x.name.trim()
	}
	for (const w of g.wishes) {
		if (!int(w.priority, 1, 10)) throw new Error("Priority must be 1–10 (1 first)")
		requireMoney(w.price, `Price of ${w.name}`)
		if (w.price === 0) throw new Error(`Enter the price of ${w.name}`)
		if (w.delivery !== null) requireMoney(w.delivery, `Delivery for ${w.name}`)
		if (w.priceSource !== undefined && !["you", "catalogue"].includes(w.priceSource)) throw new Error("Price source must be you or catalogue")
		if (!text(w.shop, 100)) throw new Error("Shop name is too long")
		if (!text(w.link, 500) || (w.link && !/^https?:\/\/\S+$/i.test(w.link))) throw new Error(`Link for ${w.name} must start with http:// or https://`)
		if (!int(w.warrantyMonths, 0, 60)) throw new Error("Warranty must be 0–60 months")
		if (!["new", "used"].includes(w.condition)) throw new Error("Condition must be new or used")
		w.shop = w.shop.trim(); w.link = w.link.trim()
	}
	for (const a of g.assets) {
		if (a.expectedPrice !== null) requireMoney(a.expectedPrice, `Expected price of ${a.name}`)
		requireMoney(a.fee, "Fee"); requireMoney(a.delivery, "Delivery")
		if (!int(a.days, 1, 365)) throw new Error("Days to sell must be 1–365")
		if (!["good", "fair"].includes(a.condition)) throw new Error("Condition must be good or fair")
	}
	return g
}

/** A catalogue product only when the name points at exactly one. */
export function matchProduct(name: string): string | null {
	const ids = resolveQuery(name).productIds
	return ids.length === 1 ? ids[0] : null
}
export const typicalPrice = (productId: string | null) => (productId && PRODUCTS.get(productId)?.msrp) || null

/** The user's entered offers, matched to the catalogue. Not checked yet: blocked until risk-checked. */
export function buildOffers(g: Goal): Offer[] {
	return g.wishes.map(w => {
		const productId = matchProduct(w.name)
		return { id: w.id, wishId: w.id, productId, name: w.name, price: w.price, delivery: w.delivery, shop: w.shop, link: w.link, warrantyMonths: w.warrantyMonths, condition: w.condition, typicalPrice: typicalPrice(productId), priceSource: w.priceSource ?? "you", risks: ["Not checked yet"], blocked: true }
	})
}

export type RiskCheck = Record<string, { risks: string[]; blocked: boolean }>
/** Heuristic risk flags per offer. Warnings, not verdicts about any shop. */
export function checkRisks(g: Goal, offers: Offer[]): RiskCheck {
	return Object.fromEntries(offers.map(o => {
		const risks: string[] = []
		let blocked = false
		const estimate = o.priceSource === "catalogue"
		if (o.delivery === null) {
			if (deliveryPending(o)) risks.push("Delivery not known yet; add it when you pick a shop")
			else { risks.push("Delivery cost unknown: ask the shop before paying"); blocked = true }
		}
		if (o.warrantyMonths < g.minWarrantyMonths) { risks.push(`Warranty ${o.warrantyMonths} months is below your minimum of ${g.minWarrantyMonths}`); blocked = true }
		if (!estimate && o.typicalPrice && o.price < o.typicalPrice * (o.condition === "new" ? 0.5 : 0.25)) { risks.push(`Price is far below the typical ${o.typicalPrice.toLocaleString("sr-RS")} RSD: check it is the same product and not a scam`); blocked = true }
		if (!o.shop) risks.push("No shop named")
		if (o.link && !/^https:/i.test(o.link)) risks.push("Link is not HTTPS")
		return [o.id, { risks, blocked }]
	}))
}
export const applyRisks = (offers: Offer[], risk: RiskCheck): Offer[] => offers.map(o => risk[o.id] ? { ...o, ...risk[o.id] } : o)
export const assessOffers = (g: Goal) => { const o = buildOffers(g); return applyRisks(o, checkRisks(g, o)) }

/** Resale from the user's expected price; otherwise a labelled estimate from the catalogue. */
export function estimateResale(g: Goal): Resale[] {
	return g.assets.flatMap(a => {
		const typical = typicalPrice(matchProduct(a.name))
		const own = a.expectedPrice !== null
		if (!own && !typical) return []
		const gross = own ? a.expectedPrice! : Math.round(typical! * (a.condition === "good" ? 0.5 : 0.4) / 100) * 100
		const net = (x: number) => Math.max(0, Math.round(x) - a.fee - a.delivery)
		return [{ assetId: a.id, gross, net: net(gross), low: net(gross * (own ? 0.9 : 0.8)), high: net(gross * (own ? 1 : 1.1)), confidence: own ? "medium" as const : "low" as const, days: a.days, basis: own ? "your price" as const : "catalogue estimate" as const }]
	})
}

const saving = (o: Offer, cost = total(o)) => o.typicalPrice && o.condition === "new" ? Math.max(0, o.typicalPrice - cost) : 0

export const emptyLedger = (): Ledger => ({ confirmedResale: 0, spent: 0, verifiedSavings: 0, sold: [], purchased: [], reservations: {}, receipts: {} })
export const total = (o: Offer) => o.price + (o.delivery ?? 0)
export const cashBalance = (g: Goal, l: Ledger) => g.cash + l.confirmedResale - l.spent
export const reserved = (l: Ledger) => Object.values(l.reservations).reduce((a, b) => a + b, 0)
/** No shop picked yet (an estimate, or a price from the prompt): unknown delivery is expected, not a red flag. */
const deliveryPending = (o: Offer) => o.delivery === null && (o.priceSource === "catalogue" || !o.shop)
export const eligible = (g: Goal, o: Offer) => money(o.price) && o.price > 0 && money(deliveryPending(o) ? 0 : o.delivery) && !o.blocked && o.warrantyMonths >= g.minWarrantyMonths
const ESTIMATE = "Enter what you actually paid: this price is only an estimate"
/** What the user actually paid: the entered amount, else the estimate for user-priced offers. */
const paidAmount = (o: Offer, paid: number | undefined) => {
	if (paid === undefined) { if (o.priceSource === "catalogue") throw new Error(ESTIMATE); return total(o) }
	requireMoney(paid, "Amount paid")
	if (paid === 0 && o.priceSource === "catalogue") throw new Error(ESTIMATE)
	return paid
}

/** Priority-first bounded optimization. Minimize cost, then sell only the items needed.
 * Estimated proceeds fund a conditional plan, NEVER the cash guard. */
export function optimize(g: Goal, l: Ledger, offers: Offer[], resale: Resale[]): Plan {
	const cash = cashBalance(g, l)
	const wishes = g.wishes.filter(w => !l.purchased.includes(w.id)).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
	const options = wishes.map(w => offers.filter(o => o.wishId === w.id && eligible(g, o)).sort((a, b) => total(a) - total(b) || a.id.localeCompare(b.id))[0])
	const assets = resale.filter(r => !l.sold.includes(r.assetId) && g.assets.some(a => a.id === r.assetId) && r.days <= g.deadlineDays && r.net > 0)
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
	const actions: Plan["actions"] = best.sells.map(r => ({ kind: "sell", id: r.assetId, name: g.assets.find(a => a.id === r.assetId)!.name, amount: r.net, when: `About ${r.days} days; wait for the money before buying`, why: r.basis === "your price" ? "Your expected price, minus fees and delivery." : "No price entered: rough estimate from the typical new price. Enter your own for a better plan." }))
	for (const o of best.buys) {
		const vs = o.typicalPrice && o.condition === "new" ? ` Typical new price is about ${o.typicalPrice.toLocaleString("sr-RS")} RSD.` : ""
		const why = o.priceSource === "catalogue" ? "Typical price (estimate); delivery not known yet." : `${o.shop || "Shop not named"}, delivery included, ${o.warrantyMonths}-month warranty (${o.condition}).${vs}`
		actions.push({ kind: "buy", id: o.id, name: o.name, amount: total(o), when: conditional ? "After the sale money arrives" : "You can afford it now", why })
	}
	for (const w of wishes) if (!best.buys.some(o => o.wishId === w.id)) {
		const o = offers.find(o => o.wishId === w.id)
		const why = o && !eligible(g, o) ? `Blocked: ${o.risks.filter(Boolean).join("; ") || "offer incomplete"}.` : "Not enough money for this one yet without breaking your reserve."
		actions.push({ kind: "wait", id: w.id, name: w.name, amount: 0, when: "Wait for a cheaper offer or more cash", why })
	}
	return {
		actions, selectedOffers: best.buys.map(o => o.id), selectedAssets: best.sells.map(r => r.assetId),
		availableCash: cash - g.reserve - reserved(l), reservedCash: reserved(l) + g.reserve,
		estimatedResale: best.proceeds, expectedCosts: best.cost, confirmedResale: l.confirmedResale, actualCosts: l.spent,
		projectedRemaining: cash + best.proceeds - best.cost, netAcquisitionCost: best.cost - best.proceeds,
		verifiedSavings: l.verifiedSavings,
		forecastSavings: best.buys.reduce((n, o) => n + saving(o), 0),
		conditional, complete: best.buys.length === wishes.length,
	}
}

/** Synchronous check + mutation: no await between cash verification and debit. */
export function transact(g: Goal, l: Ledger, offers: Offer[], command: Command): string {
	if (command.type === "confirm-sale") {
		const a = g.assets.find(a => a.id === command.assetId)
		if (!a || l.sold.includes(a.id)) throw new Error("Item missing or already sold")
		requireMoney(command.gross, "Sale price")
		const net = command.gross - a.fee - a.delivery
		if (net < 0) throw new Error("Sale does not cover fees and delivery")
		l.confirmedResale += net; l.sold.push(a.id)
		return `Sold ${a.name}: +${net.toLocaleString("sr-RS")} RSD after fees.`
	}
	if (!("offerId" in command)) throw new Error("Unknown action")
	if (command.type === "release") { delete l.reservations[command.offerId]; return "Set-aside money released" }
	const o = offers.find(o => o.id === command.offerId)
	const wish = g.wishes.find(w => w.id === o?.wishId)
	if (!o || !wish || l.purchased.includes(wish.id) || !eligible(g, o)) throw new Error("Offer is missing, blocked or already bought")
	const cost = command.type === "buy" ? paidAmount(o, command.paid) : total(o)
	const available = cashBalance(g, l) - g.reserve - reserved(l) + (l.reservations[o.id] ?? 0)
	if (cost > available) throw new Error(`Not enough cash yet: need ${cost.toLocaleString("sr-RS")} RSD, have ${available.toLocaleString("sr-RS")} RSD. Money from sales counts once it arrives.`)
	if (command.type === "reserve") { l.reservations[o.id] = cost; return `Set aside ${cost.toLocaleString("sr-RS")} RSD for ${o.name}` }
	if (command.type !== "buy") throw new Error("Unknown action")
	l.spent += cost; l.purchased.push(wish.id); delete l.reservations[o.id]
	l.verifiedSavings += saving(o, cost)
	return `Bought ${o.name}: −${cost.toLocaleString("sr-RS")} RSD`
}
