import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { DEMO_GOAL } from "./engine"
import { cashBalance, emptyLedger, optimize, reserved, transact, validateGoal } from "./model"
import type { Offer, Resale } from "./types"
const offers = JSON.parse(readFileSync(new URL("../../data/strategy/offers.json", import.meta.url), "utf8")) as Offer[]
const resale: Resale[] = [{ assetId: "old-phone", gross: 31000, net: 30000, low: 29000, high: 31000, confidence: "medium", days: 5, comparables: 3, basis: "synthetic asking prices" }]

test("target scenario: estimates are conditional, 7k remains, net acquisition 63k", () => {
	const plan = optimize(DEMO_GOAL, emptyLedger(), offers, resale)
	assert.equal(plan.expectedCosts, 93000); assert.equal(plan.estimatedResale, 30000)
	assert.equal(plan.availableCash, 70000); assert.equal(plan.projectedRemaining, 7000)
	assert.equal(plan.netAcquisitionCost, 63000); assert.equal(plan.conditional, true)
	assert.equal(plan.verifiedSavings, 0)
})
test("normal cash purchase never sells an asset unnecessarily", () => {
	const g = { ...DEMO_GOAL, cash: 100000 }
	const l = emptyLedger()
	const plan = optimize(g, l, offers, resale)
	assert.equal(plan.estimatedResale, 0); assert.equal(plan.conditional, false)
	transact(g, l, offers, { type: "buy", offerId: "phone-best" })
	transact(g, l, offers, { type: "buy", offerId: "headphones" })
	assert.equal(cashBalance(g, l), 7000)
})
test("forecast drop defers headphones; cheaper phone restores both", () => {
	const lower = resale.map(r => ({ ...r, net: 20000 }))
	const plan = optimize(DEMO_GOAL, emptyLedger(), offers, lower)
	assert.equal(plan.complete, false); assert.deepEqual(plan.selectedOffers, ["phone-best"])
	assert.ok(plan.actions.some(a => a.kind === "wait" && a.id === "audio"))
	assert.equal(plan.projectedRemaining, 5000)
	const cheap = offers.map(o => o.id === "phone-best" ? { ...o, price: 80000 } : o)
	const restored = optimize(DEMO_GOAL, emptyLedger(), cheap, lower)
	assert.equal(restored.complete, true); assert.equal(restored.projectedRemaining, 2000)
})
test("estimated funds cannot be spent; only net confirmed receipts add cash", () => {
	const l = emptyLedger()
	assert.throws(() => transact(DEMO_GOAL, l, offers, { type: "buy", offerId: "phone-best" }), /Insufficient confirmed cash/)
	assert.equal(l.spent, 0)
	transact(DEMO_GOAL, l, offers, { type: "confirm-sale", assetId: "old-phone", gross: 31000 })
	assert.equal(l.confirmedResale, 30000)
	transact(DEMO_GOAL, l, offers, { type: "buy", offerId: "phone-best" })
	transact(DEMO_GOAL, l, offers, { type: "buy", offerId: "headphones" })
	assert.equal(cashBalance(DEMO_GOAL, l), 7000)
	assert.throws(() => transact(DEMO_GOAL, l, offers, { type: "confirm-sale", assetId: "old-phone", gross: 31000 }), /already sold/)
	assert.throws(() => transact(DEMO_GOAL, l, offers, { type: "buy", offerId: "phone-best" }), /already purchased/)
})
test("reservations and untouched reserve are enforced atomically", () => {
	const g = { ...DEMO_GOAL, cash: 93000, reserve: 1000 }
	const l = emptyLedger()
	transact(g, l, offers, { type: "reserve", offerId: "phone-best" })
	assert.equal(reserved(l), 85000)
	assert.throws(() => transact(g, l, offers, { type: "buy", offerId: "headphones" }), /Insufficient/)
	transact(g, l, offers, { type: "buy", offerId: "phone-best" })
	assert.equal(reserved(l), 0); assert.equal(cashBalance(g, l), 8000)
})
test("unknown delivery, seller risk, warranty and misleading discounts fail closed", () => {
	const g = { ...DEMO_GOAL, cash: 1000000 }
	for (const update of [{ delivery: null }, { trust: 20 }, { warrantyMonths: 0 }, { advertisedPrevious: 150000 }, { history: [] }]) {
		const unsafe = offers.map(o => o.id === "phone-best" ? { ...o, ...update } : o)
		assert.throws(() => transact(g, emptyLedger(), unsafe, { type: "buy", offerId: "phone-best" }), /unsafe/)
		assert.ok(!optimize(g, emptyLedger(), unsafe, resale).selectedOffers.includes("phone-best"))
	}
})
test("illiquid resale cannot finance a deadline; no comparables means no forecast", () => {
	const g = { ...DEMO_GOAL, deadlineDays: 1 }
	assert.equal(optimize(g, emptyLedger(), offers, resale).estimatedResale, 0)
	assert.equal(optimize(g, emptyLedger(), offers, []).estimatedResale, 0)
})
test("pending seller assessment is blocked even when the user allows low trust", () => {
	const g = { ...DEMO_GOAL, cash: 1000000, minTrust: 0 }
	const pending = offers.map(o => ({ ...o, trust: -1 }))
	assert.equal(optimize(g, emptyLedger(), pending, resale).selectedOffers.length, 0)
	assert.throws(() => transact(g, emptyLedger(), pending, { type: "buy", offerId: "phone-best" }), /unsafe/)
})
test("invalid amounts cannot mutate a ledger", () => {
	for (const gross of [-1, NaN, Infinity, 1.25, 9999999999999999, 999]) {
		const l = emptyLedger()
		assert.throws(() => transact(DEMO_GOAL, l, offers, { type: "confirm-sale", assetId: "old-phone", gross }))
		assert.deepEqual(l, emptyLedger())
	}
	for (const cash of [-1, NaN, Infinity, 0.5]) assert.throws(() => validateGoal({ ...DEMO_GOAL, cash }))
	assert.throws(() => validateGoal({ ...DEMO_GOAL, wishes: [...DEMO_GOAL.wishes, DEMO_GOAL.wishes[0]] }))
})
test("budget sweep: all conditional plans conserve resources and preserve reserves", () => {
	for (let cash = 0; cash <= 120000; cash += 999) {
		const g = { ...DEMO_GOAL, cash, reserve: Math.floor(cash / 10) }
		for (const net of [0, 20000, 30000]) {
			const p = optimize(g, emptyLedger(), offers, resale.map(r => ({ ...r, net })))
			assert.ok(p.projectedRemaining >= g.reserve)
			assert.equal(p.projectedRemaining, cash + p.estimatedResale - p.expectedCosts)
			assert.ok(p.availableCash >= 0)
		}
	}
})
