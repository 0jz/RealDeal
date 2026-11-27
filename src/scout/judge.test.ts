import assert from "node:assert/strict"
import { test } from "node:test"
import { judge, judgeOffline } from "./judge"
import type { ScoutCandidate, ScoutWant } from "./types"

const want = (over: Partial<ScoutWant>): ScoutWant => ({ wantText: "x", query: "x", attributes: [], ...over })

let n = 0
function cand(title: string, over: Partial<ScoutCandidate> = {}): ScoutCandidate {
	n++
	return {
		site: "ananas",
		shop: "Ananas",
		title,
		price: 5000,
		delivery: null,
		inStock: true,
		url: `https://ananas.rs/p/${n}`,
		image: null,
		checkedAt: "2026-11-27T10:00:00.000Z",
		...over,
	}
}

test("an accessory for the item is dropped, even when its title has the query words", () => {
	const verdict = judgeOffline(want({ query: "iphone 15" }), cand("Maska za iPhone 15"))
	assert.deepEqual(verdict, { score: 0, reason: "an accessory, not the item", drop: "accessory" })
})

test("a bag for a laptop is dropped as an accessory", () => {
	const verdict = judgeOffline(want({ query: "laptop" }), cand("Lenovo torba za laptop 15.6\""))
	assert.deepEqual(verdict, { score: 0, reason: "an accessory, not the item", drop: "accessory" })
})

test("a bag requested by name is not dropped as an accessory", () => {
	const verdict = judgeOffline(want({ query: "ranac" }), cand("Nike ranac 30L crni"))
	assert.equal(verdict.drop, undefined)
	assert.equal(verdict.score, 1)
})

test("a query that asks for the accessory itself is not rejected", () => {
	const verdict = judgeOffline(want({ query: "maska za iphone 15" }), cand("Maska za iPhone 15"))
	assert.equal(verdict.drop, undefined)
	assert.equal(verdict.score, 1)
})

test("query overlap plus attributes give a full score, including across inflections", () => {
	const verdict = judgeOffline(
		want({ query: "zimska jakna", attributes: ["crna"] }),
		cand("Muška zimska jakna crna"),
	)
	assert.ok(verdict.score >= 0.8)
	assert.equal(verdict.drop, undefined)
	assert.equal(verdict.reason, "matches: zimska jakna crna")

	const inflected = judgeOffline(want({ query: "zimska jakna" }), cand("Zimske jakne za žene"))
	assert.ok(inflected.score >= 0.8)
})

test("a partial match gets a missing-words reason and a zero match is a mismatch", () => {
	const partial = judgeOffline(want({ query: "zimska jakna" }), cand("Letnja jakna"))
	assert.ok(partial.score > 0.59 && partial.score < 0.61)
	assert.equal(partial.reason, "missing: zimska")
	assert.equal(partial.drop, undefined)

	const none = judgeOffline(want({ query: "iphone 15", attributes: ["crna"] }), cand("Zimska jakna"))
	assert.deepEqual(none, { score: 0, reason: "missing: iphone 15 crna", drop: "mismatch" })
})

test("judge traces drops and keeps low scores for the ranker", async () => {
	const accessory = cand("Maska za iPhone 15")
	const low = cand("Monitor 15 inch")
	const good = cand("iPhone 15")
	const { judged, dropped } = await judge(want({ query: "iphone 15 128gb" }), [accessory, low, good])
	assert.deepEqual(judged.map((j) => j.title), ["Monitor 15 inch", "iPhone 15"])
	assert.ok(judged[0]!.score < 0.6)
	assert.deepEqual(
		dropped.map((d) => ({ title: d.title, drop: d.drop, kept: d.kept, why: d.why })),
		[{ title: accessory.title, drop: "accessory", kept: false, why: "an accessory, not the item" }],
	)
})

test("judge uses complete llm answers, clamped and shortened, but not partial or throwing ones", async () => {
	const items = [cand("iPhone 15"), cand("iPhone 15 pro")]
	const llm = async (_want: ScoutWant, titles: string[]) =>
		titles.map((title) => ({ score: title.endsWith("pro") ? 2 : -1, reason: "x".repeat(150) }))
	const { judged } = await judge(want({ query: "iphone 15" }), items, llm)
	assert.deepEqual(judged.map((j) => j.score), [0, 1])
	assert.equal(judged[0]!.reason.length, 120)

	const fallback = async () => [{ score: 1, reason: "only one" }]
	const fromFallback = await judge(want({ query: "iphone 15" }), items, fallback)
	const offline = items.map((c) => judgeOffline(want({ query: "iphone 15" }), c).reason)
	assert.deepEqual(fromFallback.judged.map((j) => j.reason), offline)

	const throwing = async (): Promise<Array<{ score: number; reason: string }> | null> => {
		throw new Error("no key")
	}
	const fromThrow = await judge(want({ query: "iphone 15" }), items, throwing)
	assert.deepEqual(fromThrow.judged.map((j) => j.reason), offline)
})

test("a listing without the model code is another product, even when the brand words match", () => {
	const w = want({ query: "Samsung Galaxy A55" })
	assert.equal(judgeOffline(w, cand("SAMSUNG Galaxy SmartTag2 Black")).drop, "mismatch")
	assert.equal(judgeOffline(w, cand("SAMSUNG Galaxy A35 5G 8/256GB")).drop, "mismatch")
	const hit = judgeOffline(w, cand("SAMSUNG Galaxy A55 5G 8/256GB Navy"))
	assert.equal(hit.drop, undefined)
	assert.ok(hit.score >= 0.6)
})

test("a variant the user didn't name and a refurbished unit rank under the exact new item", async () => {
	const w = want({ query: "iPhone 15 128GB" })
	const exact = judgeOffline(w, cand("Apple iPhone 15 6/128GB, Black"))
	const plus = judgeOffline(w, cand("Apple iPhone 15 Plus 6/128GB, Black"))
	const refurb = judgeOffline(w, cand("Apple Refabrikovani mobilni telefon iPhone 15, 6/128GB, Crni"))
	assert.equal(exact.score, 1)
	assert.deepEqual(plus, { score: 0.7, reason: "a different variant: plus" })
	assert.deepEqual(refurb, { score: 0.65, reason: "refurbished or used, not new" })
	assert.equal(judgeOffline(w, cand("Apple Refabrikovani iPhone 15 Plus 128GB")).score, 0.6)
	assert.equal(judgeOffline(want({ query: "iPhone 15 Plus" }), cand("Apple iPhone 15 Plus 128GB")).score, 1)
	assert.equal(judgeOffline(want({ query: "refurbished iPhone 15" }), cand("Refurbished iPhone 15 128GB")).score, 1)
})

test("a generic category query matches devices by model and drops other categories", () => {
	const phone = judgeOffline(want({ query: "telefon" }), cand("Apple iPhone 15 128GB Black"))
	assert.equal(phone.drop, undefined)
	assert.equal(phone.score, 0.9)
	assert.equal(phone.reason, "matches: iPhone 15")

	const laptop = judgeOffline(want({ query: "telefon" }), cand("MacBook Air M3 512GB"))
	assert.equal(laptop.drop, "mismatch")
	assert.equal(laptop.reason, "not what you asked for")

	const unrecognised = judgeOffline(want({ query: "telefon" }), cand("Random thing"))
	assert.equal(unrecognised.drop, "mismatch")
})

test("a brand query keeps only that brand's devices", () => {
	assert.equal(judgeOffline(want({ query: "iphone" }), cand("Apple iPhone 15 128GB Black")).drop, undefined)
	assert.equal(judgeOffline(want({ query: "iphone" }), cand("Samsung Galaxy S24 128GB")).drop, "mismatch")
})

test("for a generic query a refurbished device scores under a new one", () => {
	const newPhone = judgeOffline(want({ query: "telefon" }), cand("Apple iPhone 15 128GB Black"))
	const refurb = judgeOffline(want({ query: "telefon" }), cand("Refabrikovani Apple iPhone 15 128GB"))
	assert.equal(newPhone.score, 0.9)
	assert.equal(refurb.score, 0.65)
})
