import assert from "node:assert/strict"
import { test } from "node:test"
import { buildQueries, fold, siteFits } from "./query"
import type { ScoutWant } from "./types"

const want = (over: Partial<ScoutWant>): ScoutWant => ({ wantText: "x", query: "x", attributes: [], ...over })

test("buildQueries adds the folded query and attribute queries, deduped and capped at four", () => {
	assert.deepEqual(
		buildQueries(want({ query: "zimska jakna", attributes: ["crna", "M", "muska", "extra"] })),
		["zimska jakna", "zimska jakna crna", "zimska jakna M", "zimska jakna muska"],
	)
	assert.deepEqual(buildQueries(want({ query: "Muška jakna" })), ["Muška jakna", "Muska jakna"])
	assert.deepEqual(buildQueries(want({ query: "Đorđe džemper" })), ["Đorđe džemper", "Djordje dzemper"])
})

test("buildQueries dedupes case-insensitively", () => {
	assert.deepEqual(buildQueries(want({ query: "iPhone 15", attributes: ["IPHONE 15"] })), ["iPhone 15", "iPhone 15 IPHONE 15"])
	assert.deepEqual(buildQueries(want({ query: "jakna" })), ["jakna"])
})

test("fold handles the Serbian letters without changing ordinary text", () => {
	assert.equal(fold("Č ć Š Ž đ Đ"), "C c S Z dj Dj")
	assert.equal(fold("iPhone 15"), "iPhone 15")
})

test("clothing and shoes skip the electronics shops but never Ananas or Office Shoes", () => {
	for (const site of ["tehnomedia", "gigatron"] as const) {
		assert.equal(siteFits(site, want({ query: "Zimska jakna" })), false)
		assert.equal(siteFits(site, want({ query: "muška obuća" })), false)
		assert.equal(siteFits(site, want({ query: "nike sneakers" })), false)
		assert.equal(siteFits(site, want({ query: "iPhone 15" })), true)
		assert.equal(siteFits(site, want({ query: "jaknica" })), true)
	}
	assert.equal(siteFits("ananas", want({ query: "cipele" })), true)
	assert.equal(siteFits("officeshoes", want({ query: "patike" })), true)
})
