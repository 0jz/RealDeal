import assert from "node:assert/strict"
import { test } from "node:test"
import { filterRange, inRange, rank, toSlots } from "./rank"
import type { ScoutCandidate, ScoutWant } from "./types"

const want = (over: Partial<ScoutWant>): ScoutWant => ({ wantText: "x", query: "x", attributes: [], ...over })

let n = 0
function cand(over: Partial<ScoutCandidate> & { score?: number; reason?: string } = {}) {
	n++
	return {
		site: "ananas" as const,
		shop: "Ananas",
		title: `Product ${n}`,
		price: 10000,
		delivery: null,
		inStock: true,
		url: `https://ananas.rs/p/${n}`,
		image: null,
		checkedAt: "2026-11-27T10:00:00.000Z",
		score: 0.9,
		reason: "matches",
		...over,
	}
}

test("range: min only, max only, both, none, edges", () => {
	assert.equal(inRange(5000, { minPrice: 5000 }), true)
	assert.equal(inRange(4999, { minPrice: 5000 }), false)
	assert.equal(inRange(10000, { maxPrice: 10000 }), true)
	assert.equal(inRange(10001, { maxPrice: 10000 }), false)
	assert.equal(inRange(8000, { minPrice: 8000, maxPrice: 12000 }), true)
	assert.equal(inRange(12001, { minPrice: 8000, maxPrice: 12000 }), false)
	assert.equal(inRange(7999, { minPrice: 8000, maxPrice: 12000 }), false)
	assert.equal(inRange(1, {}), true)
})

test("filterRange keeps in-range candidates and traces the rest in plain words", () => {
	const a = cand({ price: 12999 })
	const b = cand({ price: 9000 })
	const c = cand({ price: 3000 })
	const { kept, dropped } = filterRange([a, b, c], want({ maxPrice: 10000, minPrice: 5000 }))
	assert.deepEqual(kept.map((x) => x.price), [9000])
	assert.equal(dropped.length, 2)
	assert.equal(dropped[0].why, "12.999 RSD is over your 10.000 limit")
	assert.equal(dropped[1].why, "3.000 RSD is under your 5.000 minimum")
	for (const d of dropped) {
		assert.equal(d.kept, false)
		assert.equal(d.score, null)
		assert.equal(d.drop, "out of range")
	}
})

test("filterRange with no range keeps everything", () => {
	const { kept, dropped } = filterRange([cand({ price: 1 }), cand({ price: 99999999 })], want({}))
	assert.equal(kept.length, 2)
	assert.equal(dropped.length, 0)
})

test("rank drops scores under 0.6 with the judge's reason and keeps 0.6", () => {
	const { ordered, dropped } = rank([
		cand({ score: 0.59, reason: "accessory" }),
		cand({ score: 0.6, reason: "close" }),
	])
	assert.equal(ordered.length, 1)
	assert.equal(ordered[0].score, 0.6)
	assert.equal(ordered[0].verified, false)
	assert.equal(dropped[0].drop, "low score")
	assert.equal(dropped[0].why, "accessory")
	assert.equal(dropped[0].score, 0.59)
})

test("rank orders by score, then total price with delivery", () => {
	const a = cand({ title: "A", score: 0.8, price: 5000, delivery: 0 })
	const b = cand({ title: "B", score: 0.95, price: 9000, delivery: null })
	const c = cand({ title: "C", score: 0.8, price: 4000, delivery: 1500 })
	const d = cand({ title: "D", score: 0.8, price: 5200, delivery: null })
	const { ordered } = rank([a, b, c, d])
	assert.deepEqual(ordered.map((x) => x.title), ["B", "A", "D", "C"])
})

test("scores within 0.05 count as equal and sort by price", () => {
	const cheapLower = cand({ title: "cheap", score: 0.85, price: 3000 })
	const priceyHigher = cand({ title: "pricey", score: 0.9, price: 8000 })
	const { ordered } = rank([priceyHigher, cheapLower])
	assert.deepEqual(ordered.map((x) => x.title), ["cheap", "pricey"])

	const far = cand({ title: "far", score: 0.8, price: 1000 })
	const top = cand({ title: "top", score: 0.95, price: 9000 })
	assert.deepEqual(rank([far, top]).ordered.map((x) => x.title), ["top", "far"])
})

test("same URL keeps the first and drops the rest as duplicate", () => {
	const url = "https://tehnomedia.rs/p/same"
	const first = cand({ title: "First", url, score: 0.95 })
	const again = cand({ title: "Again", url, score: 0.7 })
	const { ordered, dropped } = rank([again, first])
	assert.deepEqual(ordered.map((x) => x.title), ["First"])
	assert.equal(dropped[0].drop, "duplicate")
	assert.equal(dropped[0].title, "Again")
})

test("at most 2 of the same product, matched across diacritics, đ and punctuation", () => {
	const items = [
		cand({ title: "Đorđe Jakna, crna!", score: 0.9, price: 1000 }),
		cand({ title: "Djordje  jakna crna", score: 0.9, price: 2000 }),
		cand({ title: "Djordje Jákna   crna", score: 0.9, price: 3000 }),
		cand({ title: "Djordje jakna crna.", score: 0.9, price: 4000 }),
		cand({ title: "Djordje jakna crna XL", score: 0.9, price: 5000 }),
	]
	const { ordered, dropped } = rank(items)
	assert.deepEqual(ordered.map((x) => x.price), [1000, 2000, 5000])
	assert.deepEqual(dropped.map((d) => d.price), [3000, 4000])
	assert.ok(dropped.every((d) => d.drop === "duplicate"))
})

test("toSlots never pads and caps mentions at 7", () => {
	const list = (k: number) => rank(Array.from({ length: k }, (_, i) => cand({ title: `P${i}`, price: 1000 + i, score: 0.9 }))).ordered
	const zero = toSlots([])
	assert.deepEqual(zero, { best: null, next: [], mentions: [] })

	const one = toSlots(list(1))
	assert.equal(one.best?.title, "P0")
	assert.equal(one.next.length, 0)
	assert.equal(one.mentions.length, 0)

	const three = toSlots(list(3))
	assert.equal(three.next.length, 2)
	assert.equal(three.mentions.length, 0)

	const five = toSlots(list(5))
	assert.equal(five.next.length, 2)
	assert.equal(five.mentions.length, 2)

	const twelve = toSlots(list(12))
	assert.equal(twelve.best?.title, "P0")
	assert.deepEqual(twelve.next.map((x) => x.title), ["P1", "P2"])
	assert.equal(twelve.mentions.length, 7)
	assert.equal(twelve.mentions[6].title, "P9")
})
