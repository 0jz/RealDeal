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

test("Russian laptop budget shorthand preserves the request and searches the local category", () => {
	for (const text of ["ноутбук до 100к", "Ноутбуки до 100000 RSD"]) {
		const { intent } = parsePrompt(text)
		assert.equal(intent.budget, 100000)
		assert.equal(intent.wants.length, 1)
		assert.equal(intent.wants[0].text, text)
		assert.equal(intent.wants[0].query, "laptop")
		assert.equal(intent.wants[0].category, "laptop")
		assert.equal(intent.wants[0].maxPrice, 100000)
	}
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

const onlyWant = (text: string) => {
	const wants = parsePrompt(text).intent.wants
	assert.equal(wants.length, 1, text)
	return wants[0]
}

test("max range forms in Serbian, without diacritics and in English", () => {
	const cases: [string, number][] = [
		["laptop do 100 hiljada", 100000],
		["laptop ispod 100k", 100000],
		["laptop najviše 100k", 100000],
		["laptop najvise 100k", 100000],
		["laptop maks 100k", 100000],
		["laptop max 100k", 100000],
		["laptop under 100k", 100000],
	]
	for (const [text, max] of cases) {
		const w = onlyWant(text)
		assert.equal(w.maxPrice, max, text)
		assert.equal(w.minPrice, undefined, text)
	}
})

test("min range forms in Serbian, without diacritics and in English", () => {
	const cases = ["zimska jakna od 50k", "zimska jakna preko 50k", "zimska jakna najmanje 50k", "zimska jakna min 50k", "zimska jakna over 50k"]
	for (const text of cases) {
		const w = onlyWant(text)
		assert.equal(w.minPrice, 50000, text)
		assert.equal(w.maxPrice, undefined, text)
	}
})

test("between ranges with and without diacritics, dashes and English", () => {
	const cases: [string, number, number][] = [
		["laptop između 50 i 80k", 50000, 80000],
		["laptop izmedju 50 i 80k", 50000, 80000],
		["laptop 50–80k", 50000, 80000],
		["laptop 50-80k", 50000, 80000],
		["laptop 50-80 hiljada", 50000, 80000],
		["laptop between 50k and 80k", 50000, 80000],
	]
	for (const [text, min, max] of cases) {
		const w = onlyWant(text)
		assert.equal(w.minPrice, min, text)
		assert.equal(w.maxPrice, max, text)
	}
})

test("a unit on the second number applies to both", () => {
	const w = onlyWant("laptop između 8 i 12 hiljada")
	assert.equal(w.minPrice, 8000)
	assert.equal(w.maxPrice, 12000)
})

test("around gives plus or minus 20 percent", () => {
	for (const text of ["telefon oko 30k", "telefon around 30k", "telefon ~30k"]) {
		const w = onlyWant(text)
		assert.equal(w.minPrice, 24000, text)
		assert.equal(w.maxPrice, 36000, text)
	}
})

test("a price next to an item keeps price and sets maxPrice", () => {
	const w = onlyWant("iPhone 15 za 85k")
	assert.equal(w.productId, "iphone-15")
	assert.equal(w.price, 85000)
	assert.equal(w.maxPrice, 85000)
	assert.equal(w.query, "iPhone 15")
})

test("clothing want with a price limit and buy verb keeps colour as attribute", () => {
	const w = onlyWant("hoću crnu zimsku jaknu do 8000")
	assert.equal(w.query, "crnu zimsku jaknu")
	assert.deepEqual(w.attributes, ["black"])
	assert.equal(w.maxPrice, 8000)
	assert.equal(w.productId, undefined)
	assert.equal(w.category, undefined)
})

test("clothing want with no buy verb still counts when it has a price limit", () => {
	const w = onlyWant("zimska jakna do 8000")
	assert.equal(w.query, "zimska jakna")
	assert.equal(w.maxPrice, 8000)
	assert.deepEqual(w.attributes, [])
})

test("shoes: size is an attribute, the size number is not a price, between range stays one clause", () => {
	const { intent, unknown } = parsePrompt("patike Nike broj 43 između 8 i 12 hiljada")
	assert.equal(intent.wants.length, 1)
	assert.deepEqual(unknown, [])
	const w = intent.wants[0]
	assert.ok(w.query?.includes("patike Nike"), w.query)
	assert.ok(w.attributes?.includes("size 43"), String(w.attributes))
	assert.equal(w.minPrice, 8000)
	assert.equal(w.maxPrice, 12000)
	assert.equal(w.price, undefined)
})

test("grocery item with a buy verb and a price limit", () => {
	const w = onlyWant("treba mi maslinovo ulje do 1500")
	assert.equal(w.query, "maslinovo ulje")
	assert.equal(w.maxPrice, 1500)
})

test("storage and model numbers are not prices", () => {
	const w = onlyWant("iPhone 15 128GB za 85k")
	assert.equal(w.query, "iPhone 15 128GB")
	assert.deepEqual(w.attributes, ["128GB"])
	assert.equal(w.price, 85000)
	const gpu = onlyWant("RTX 4060 do 80k")
	assert.equal(gpu.maxPrice, 80000)
	assert.equal(parsePrompt("laptop 4000mah").intent.wants[0].maxPrice, undefined)
})

test("condition and new or used attributes", () => {
	const w = onlyWant("zimska jakna crna polovna do 8000")
	assert.deepEqual(w.attributes, ["black", "used"])
	assert.equal(w.query, "zimska jakna crna polovna")
})

test("nothing to buy stays nothing", () => {
	const { intent, unknown } = parsePrompt("asdf qwerty")
	assert.equal(intent.wants.length, 0)
	assert.deepEqual(unknown, ["asdf qwerty"])
})
