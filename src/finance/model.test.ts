import assert from "node:assert/strict"
import { test } from "node:test"
import { EXAMPLE_GOAL } from "./engine"
import { assessOffers, cashBalance, emptyLedger, estimateResale, matchProduct, optimize, reserved, transact, validateGoal } from "./model"
import type { Goal } from "./types"

const G = EXAMPLE_GOAL
const withWish = (g: Goal, id: string, patch: Partial<Goal["wishes"][number]>): Goal => ({ ...g, wishes: g.wishes.map(w => w.id === id ? { ...w, ...patch } : w) })
const plan = (g: Goal, l = emptyLedger()) => optimize(g, l, assessOffers(g), estimateResale(g))

test("names match the catalogue only when unambiguous", () => {
	assert.equal(matchProduct("iPhone 15"), "iphone-15")
	assert.equal(matchProduct("AirPods Pro 2"), "airpods-pro-2")
	assert.equal(matchProduct("grandma's bike"), null)
})
test("example: the sale funds the gap, 3,600 remains, plan is conditional", () => {
	const p = plan(G)
	assert.equal(p.expectedCosts, 110400); assert.equal(p.estimatedResale, 39000)
	assert.equal(p.availableCash, 75000); assert.equal(p.projectedRemaining, 3600)
	assert.equal(p.netAcquisitionCost, 71400); assert.equal(p.conditional, true)
	assert.equal(p.forecastSavings, 4600, "AirPods 25,400 delivered vs typical 30,000")
})
test("enough cash never sells anything", () => {
	const g = { ...G, cash: 120000 }
	const l = emptyLedger()
	const p = plan(g, l)
	assert.equal(p.estimatedResale, 0); assert.equal(p.conditional, false)
	const offers = assessOffers(g)
	transact(g, l, offers, { type: "buy", offerId: "phone" })
	transact(g, l, offers, { type: "buy", offerId: "audio" })
	assert.equal(cashBalance(g, l), 9600)
	assert.equal(l.verifiedSavings, 4600)
})
test("a lower sale price defers the second wish; a cheaper offer restores it", () => {
	const lower = { ...G, assets: G.assets.map(a => ({ ...a, expectedPrice: 30000 })) }
	const p = plan(lower)
	assert.equal(p.complete, false); assert.deepEqual(p.selectedOffers, ["phone"])
	assert.ok(p.actions.some(a => a.kind === "wait" && a.id === "audio"))
	const cheaper = withWish(lower, "phone", { price: 75000 })
	const restored = plan(cheaper)
	assert.equal(restored.complete, true); assert.equal(restored.projectedRemaining, 3600)
})
test("expected sale money can't be spent; only recorded sales add cash", () => {
	const l = emptyLedger()
	const offers = assessOffers(G)
	assert.throws(() => transact(G, l, offers, { type: "buy", offerId: "phone" }), /Not enough cash/)
	assert.equal(l.spent, 0)
	transact(G, l, offers, { type: "confirm-sale", assetId: "old-phone", gross: 40000 })
	assert.equal(l.confirmedResale, 39000)
	transact(G, l, offers, { type: "buy", offerId: "phone" })
	transact(G, l, offers, { type: "buy", offerId: "audio" })
	assert.equal(cashBalance(G, l), 3600)
	assert.throws(() => transact(G, l, offers, { type: "confirm-sale", assetId: "old-phone", gross: 40000 }), /already sold/)
	assert.throws(() => transact(G, l, offers, { type: "buy", offerId: "phone" }), /already bought/)
})
test("set-aside money and the reserve are enforced", () => {
	const g = { ...G, cash: 110000, reserve: 1000 }
	const l = emptyLedger()
	const offers = assessOffers(g)
	transact(g, l, offers, { type: "reserve", offerId: "phone" })
	assert.equal(reserved(l), 85000)
	assert.throws(() => transact(g, l, offers, { type: "buy", offerId: "audio" }), /Not enough cash/)
	transact(g, l, offers, { type: "buy", offerId: "phone" })
	assert.equal(reserved(l), 0); assert.equal(cashBalance(g, l), 25000)
})
test("unknown delivery, short warranty and too-good-to-be-true prices are blocked", () => {
	const rich = { ...G, cash: 1000000 }
	for (const patch of [{ delivery: null }, { warrantyMonths: 0 }, { price: 30000 }]) {
		const g = withWish(rich, "phone", patch)
		const offers = assessOffers(g)
		assert.ok(offers.find(o => o.id === "phone")!.blocked, JSON.stringify(patch))
		assert.throws(() => transact(g, emptyLedger(), offers, { type: "buy", offerId: "phone" }), /blocked/)
		assert.ok(!plan(g).selectedOffers.includes("phone"))
	}
	const noShop = assessOffers(withWish(rich, "phone", { shop: "" })).find(o => o.id === "phone")!
	assert.equal(noShop.blocked, false); assert.ok(noShop.risks.includes("No shop named"))
})
test("sale price falls back to a labelled catalogue estimate; unknown items can't fund anything", () => {
	const est = estimateResale({ ...G, assets: [{ ...G.assets[0], expectedPrice: null }] })
	assert.equal(est[0].basis, "catalogue estimate"); assert.equal(est[0].confidence, "low")
	assert.equal(est[0].gross, 31000)
	assert.deepEqual(estimateResale({ ...G, assets: [{ ...G.assets[0], name: "old bike", expectedPrice: null }] }), [])
	assert.equal(plan({ ...G, deadlineDays: 1 }).estimatedResale, 0, "a sale slower than the deadline can't fund it")
})
test("unchecked offers are never selected", () => {
	const unchecked = assessOffers(G).map(o => ({ ...o, blocked: true }))
	assert.equal(optimize({ ...G, cash: 1000000 }, emptyLedger(), unchecked, []).selectedOffers.length, 0)
})
test("catalogue estimate with unknown delivery: a warning, not a block, and it can be planned", () => {
	const g = withWish({ ...G, cash: 1000000 }, "phone", { delivery: null, priceSource: "catalogue" })
	const o = assessOffers(g).find(o => o.id === "phone")!
	assert.equal(o.blocked, false); assert.equal(o.priceSource, "catalogue")
	assert.ok(o.risks.includes("Delivery not known yet; add it when you pick a shop"))
	const p = plan(g)
	assert.ok(p.selectedOffers.includes("phone"))
	assert.equal(p.actions.find(a => a.id === "phone")!.why, "Typical price (estimate); delivery not known yet.")
})
test("catalogue estimate far below typical is not blocked by the too-cheap check", () => {
	const g = withWish({ ...G, cash: 1000000 }, "phone", { price: 30000, priceSource: "catalogue" })
	const o = assessOffers(g).find(o => o.id === "phone")!
	assert.equal(o.blocked, false)
	assert.ok(!o.risks.some(r => r.startsWith("Price is far below")))
})
test("a user-priced offer with unknown delivery is still blocked", () => {
	const o = assessOffers(withWish({ ...G, cash: 1000000 }, "phone", { delivery: null })).find(o => o.id === "phone")!
	assert.equal(o.blocked, true); assert.equal(o.priceSource, "you")
	assert.ok(o.risks.includes("Delivery cost unknown: ask the shop before paying"))
})
test("buying an estimate requires the amount paid, and the ledger records that amount", () => {
	const g = withWish({ ...G, cash: 1000000 }, "phone", { priceSource: "catalogue" })
	const offers = assessOffers(g)
	const l = emptyLedger()
	assert.throws(() => transact(g, l, offers, { type: "buy", offerId: "phone" }), /actually paid/)
	assert.throws(() => transact(g, l, offers, { type: "buy", offerId: "phone", paid: 0 }), /actually paid/)
	assert.equal(l.spent, 0)
	transact(g, l, offers, { type: "buy", offerId: "phone", paid: 82000 })
	assert.equal(l.spent, 82000); assert.equal(cashBalance(g, l), 1000000 - 82000)
	assert.equal(l.verifiedSavings, Math.max(0, (offers.find(o => o.id === "phone")!.typicalPrice ?? 0) - 82000))
})
test("a user-priced buy uses the amount paid when given", () => {
	const g = { ...G, cash: 1000000 }
	const offers = assessOffers(g)
	const l = emptyLedger()
	transact(g, l, offers, { type: "buy", offerId: "phone", paid: 80000 })
	assert.equal(l.spent, 80000)
	assert.throws(() => validateGoal(withWish(G, "phone", { priceSource: "bogus" as never })), /Price source/)
})
test("invalid input can't mutate a ledger or create a goal", () => {
	for (const gross of [-1, NaN, Infinity, 1.25, 9999999999999999, 999]) {
		const l = emptyLedger()
		assert.throws(() => transact(G, l, assessOffers(G), { type: "confirm-sale", assetId: "old-phone", gross }))
		assert.deepEqual(l, emptyLedger())
	}
	for (const cash of [-1, NaN, Infinity, 0.5]) assert.throws(() => validateGoal({ ...G, cash }))
	assert.throws(() => validateGoal({ ...G, wishes: [...G.wishes, G.wishes[0]] }), /Duplicate/)
	assert.throws(() => validateGoal(withWish(G, "phone", { link: "javascript:alert(1)" })), /http/)
	assert.throws(() => validateGoal(withWish(G, "phone", { price: 0 })), /price/)
	assert.throws(() => validateGoal({ ...G, wishes: [] }))
})
test("budget sweep: every plan conserves money and keeps the reserve", () => {
	for (let cash = 0; cash <= 150000; cash += 999) {
		for (const expectedPrice of [0, 30000, 40000]) {
			const g = { ...G, cash, reserve: Math.floor(cash / 10), assets: G.assets.map(a => ({ ...a, expectedPrice })) }
			const p = plan(g)
			assert.ok(p.projectedRemaining >= g.reserve)
			assert.equal(p.projectedRemaining, cash + p.estimatedResale - p.expectedCosts)
			assert.ok(p.availableCash >= 0)
		}
	}
})
