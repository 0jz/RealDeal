import assert from "node:assert/strict"
import { test } from "node:test"
import { choosePicks, estimateSale, priceFlag, rowScore, withinBudget } from "./rank"
import type { ResultRow } from "./types"

function row(over: Partial<ResultRow>): ResultRow {
	const r: ResultRow = {
		key: `kp|${Math.random()}`,
		source: "kp",
		sourceName: "KupujemProdajem",
		kind: "classified",
		title: "x",
		url: "https://example.test",
		price: 50000,
		shipping: null,
		total: 50000,
		condition: "used",
		city: null,
		shopName: null,
		storageGb: null,
		productId: "iphone-13",
		confidence: 0.95,
		method: "rule",
		market: 50000,
		flag: "fair",
		thirtyDay: null,
		shopTrust: null,
		score: 0,
		why: "",
		...over,
	}
	r.score = rowScore(r)
	return r
}

test("budget is a hard cap: 1 RSD over is never picked, even when it's the best device", () => {
	const rows = [
		row({ productId: "iphone-16-pro", price: 99_501, shipping: 500, total: 100_001 }), // best device, 1 RSD over
		row({ productId: "iphone-15-pro", price: 99_000, total: 99_000 }),
		row({ productId: "iphone-13", price: 45_000, total: 45_000 }),
	]
	const picks = choosePicks(rows, 100_000)
	assert.ok(picks.length > 0)
	assert.ok(picks.every((p) => p.total <= 100_000))
	assert.ok(!picks.some((p) => p.productId === "iphone-16-pro"))
	assert.equal(picks[0].productId, "iphone-15-pro")
	assert.equal(picks[0].leftover, 1000)
})

test("budget counts delivery: price under budget but price+shipping over is out", () => {
	const rows = [row({ productId: "galaxy-s24", price: 99_800, shipping: 400, total: 100_200 })]
	assert.equal(withinBudget(rows, 100_000).length, 0)
	assert.equal(choosePicks(rows, 100_000).length, 0)
})

test("exactly at budget is allowed", () => {
	assert.equal(choosePicks([row({ total: 100_000, price: 100_000 })], 100_000).length, 1)
})

test("scam-priced, fake-discount and low-trust rows are never picked", () => {
	const rows = [
		row({ productId: "iphone-15-pro", flag: "suspicious", total: 30_000 }),
		row({ productId: "iphone-15", kind: "shop", thirtyDay: { legal: false, realLow: 80_000, claimedPct: 40, realPct: 2 }, total: 78_000 }),
		row({ productId: "galaxy-s24", kind: "shop", shopTrust: 40, total: 70_000 }),
		row({ productId: "iphone-13", total: 45_000 }),
	]
	assert.deepEqual(
		choosePicks(rows, 100_000).map((p) => p.productId),
		["iphone-13"],
	)
})

test("one pick per product, better device first", () => {
	const rows = [row({ productId: "iphone-13", total: 40_000 }), row({ productId: "iphone-13", total: 42_000 }), row({ productId: "iphone-15", total: 80_000 })]
	assert.deepEqual(
		choosePicks(rows, 100_000).map((p) => p.productId),
		["iphone-15", "iphone-13"],
	)
})

test("price flags", () => {
	assert.equal(priceFlag(30_000, 100_000, true), "suspicious")
	assert.equal(priceFlag(30_000, 100_000, false), "great")
	assert.equal(priceFlag(90_000, 100_000, true), "good")
	assert.equal(priceFlag(120_000, 100_000, true), "high")
})

test("sell estimate uses comps of the same model and condition", () => {
	const rows = [50_000, 52_000, 55_000, 58_000, 60_000].map((p) => row({ productId: "iphone-13", price: p, total: p }))
	rows.push(row({ productId: "iphone-13", condition: "sealed", price: 70_000, total: 70_000 }))
	const est = estimateSale({ productId: "iphone-13", condition: "used", storageGb: null, text: "iPhone 13 polovan baterija 86%", rows })
	assert.equal(est.comps.length, 5)
	assert.ok(est.quick! < est.patient!)
	assert.ok(est.quick! >= 50_000 && est.patient! <= 60_000)
	assert.match(est.draft!.description, /86%/)
})
