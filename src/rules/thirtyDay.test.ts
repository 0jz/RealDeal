import assert from "node:assert/strict"
import { test } from "node:test"
import { checkThirtyDay } from "./thirtyDay"
test("misleading discount uses observed low, not advertised previous price", () => {
	const r = checkThirtyDay({ history: Array(30).fill(100000), shownPrevPrice: 125000 }, 100000)
	assert.equal(r.status, "misleading-reference"); assert.equal(r.realDiscountPct, 0); assert.equal(r.claimedDiscountPct, 20)
})
test("gaps and empty histories are inconclusive, never inferred new-product exceptions", () => {
	for (const history of [[], Array(30).fill(null), [...Array(15).fill(null), ...Array(15).fill(100)]]) {
		const r = checkThirtyDay({ history, shownPrevPrice: 100 }, 80)
		assert.equal(r.status, "insufficient-history"); assert.equal(r.legal, false)
		assert.ok(Number.isFinite(r.realLow))
	}
})
test("explicit assortment age requires at least 15 days and keeps earlier lower prices", () => {
	assert.equal(checkThirtyDay({ history: Array(15).fill(100), shownPrevPrice: 100, assortmentDays: 15 }, 80).legal, true)
	assert.equal(checkThirtyDay({ history: Array(10).fill(100), shownPrevPrice: 100, assortmentDays: 10 }, 80).legal, false)
	assert.equal(checkThirtyDay({ history: [70, ...Array(19).fill(100)], shownPrevPrice: 100, assortmentDays: 20 }, 80).legal, false)
})
test("perishables are excluded; progressive reductions use pre-campaign history", () => {
	assert.equal(checkThirtyDay({ history: Array(30).fill(100), shownPrevPrice: 100, perishable: true }, 80).status, "exception")
	assert.equal(checkThirtyDay({ history: Array(30).fill(80), shownPrevPrice: 100, campaignReferenceHistory: Array(30).fill(100) }, 70).legal, true)
})
