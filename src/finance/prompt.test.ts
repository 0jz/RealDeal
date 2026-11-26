import assert from "node:assert/strict"
import { test } from "node:test"
import { MAX_PROMPT, parsePrompt } from "./prompt"

test("phone want plus iPhone 13 sale", () => {
	const { intent } = parsePrompt("New phone for 75000 RSD. I can sell my iPhone 13, it's in good shape.")
	assert.equal(intent.wants.length, 1)
	const w = intent.wants[0]
	assert.equal(w.category, "phone")
	assert.equal(w.productId, undefined)
	assert.equal(w.maxPrice, 75000)
	assert.equal(w.price, undefined)
	assert.equal(intent.sells.length, 1)
	assert.equal(intent.sells[0].productId, "iphone-13")
	assert.equal(intent.sells[0].condition, "good")
	assert.equal(intent.budget, 75000)
})

test("Serbian want with price and old phone sale", () => {
	const { intent } = parsePrompt("hoću iPhone 15 za 85k, prodajem stari ajfon 13")
	assert.equal(intent.wants.length, 1)
	assert.equal(intent.wants[0].productId, "iphone-15")
	assert.equal(intent.wants[0].price, 85000)
	assert.equal(intent.sells.length, 1)
	assert.equal(intent.sells[0].productId, "iphone-13")
})

test("category-only want with an upper limit", () => {
	const { intent } = parsePrompt("laptop do 100 hiljada")
	assert.equal(intent.wants.length, 1)
	assert.equal(intent.wants[0].category, "laptop")
	assert.equal(intent.wants[0].maxPrice, 100000)
})

test("budget and two category wants keep priority order", () => {
	const { intent } = parsePrompt("imam 120k, treba mi telefon i konzola")
	assert.equal(intent.budget, 120000)
	assert.equal(intent.wants.length, 2)
	assert.equal(intent.wants[0].category, "phone")
	assert.equal(intent.wants[0].priority, 1)
	assert.equal(intent.wants[1].category, "console")
	assert.equal(intent.wants[1].priority, 2)
})

test("English sale condition follow-up and a want", () => {
	const { intent } = parsePrompt("Selling my old Galaxy S23, it's a bit scratched. Want an iPhone 15.")
	assert.equal(intent.sells.length, 1)
	assert.equal(intent.sells[0].productId, "galaxy-s23")
	assert.equal(intent.sells[0].condition, "fair")
	assert.equal(intent.wants.length, 1)
	assert.equal(intent.wants[0].productId, "iphone-15")
})

test("nonsense lands in unknown", () => {
	const { intent, unknown } = parsePrompt("asdf qwerty")
	assert.equal(intent.wants.length, 0)
	assert.equal(intent.sells.length, 0)
	assert.ok(unknown.length > 0)
})

test("invalid prompts throw", () => {
	assert.equal(MAX_PROMPT, 1000)
	assert.throws(() => parsePrompt("a".repeat(5000)))
	assert.throws(() => parsePrompt("   "))
})

test("price formats and model numbers", () => {
	for (const t of ["imam 85.000", "imam 85,000", "imam 85 000 rsd", "imam 85 hiljada"]) {
		assert.equal(parsePrompt(t).intent.budget, 85000, t)
	}
	const { intent } = parsePrompt("iPhone 15")
	assert.equal(intent.wants[0].productId, "iphone-15")
	assert.equal(intent.wants[0].price, undefined)
	assert.equal(intent.wants[0].maxPrice, undefined)
	assert.equal(intent.budget, undefined)
})
