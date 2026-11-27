import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { test } from "node:test"
import { filterCards, parseEponudaCards, type Card } from "./eponuda"
import { CUSTOMER_HEADERS, isChallenge } from "./customer"

const category = readFile(resolve(process.cwd(), "data/pages/eponuda/category-mobilni-telefoni.html"), "utf8")

test("parses the product cards of a live category page", async () => {
	const cards = parseEponudaCards(await category)
	assert.ok(cards.length >= 40, `expected the page's cards, got ${cards.length}`)
	const first = cards[0]!
	assert.ok(first.title.length > 3)
	assert.ok(first.price > 1000, "price is integer RSD")
	assert.ok(first.url.startsWith("https://www.eponuda.com/"))
	assert.ok(first.shopId)
	assert.ok(first.shopName)
	assert.equal(typeof first.id, "string")
})

test("cards link to eponuda product pages or outbound shop redirects", async () => {
	const cards = parseEponudaCards(await category)
	assert.ok(cards.length > 0)
	for (const c of cards) {
		assert.ok(/-cena-\d+$/.test(c.url) || c.url.includes("/link?"), `unexpected url ${c.url}`)
	}
	const internal = cards.filter((c) => /-cena-\d+$/.test(c.url))
	assert.ok(internal.length >= 10, "most cards link to eponuda's own product pages")
})

test("cards carry the best offer's shop name and an https image", async () => {
	const cards = parseEponudaCards(await category)
	const withImage = cards.filter((c) => c.image)
	assert.ok(withImage.length >= 8)
	assert.ok(withImage.every((c) => c.image!.startsWith("https://img.ep-cdn.com/")))
	const shops = new Set(cards.map((c) => c.shopName).filter(Boolean))
	assert.ok(shops.size >= 2, "several shops sell the category's products")
})

test("filters cards by every term word except generic category words", async () => {
	const cards = parseEponudaCards(await category)
	const matched = filterCards(cards, "iphone 15")
	assert.ok(matched.length >= 1)
	assert.ok(matched.every((c) => /iphone/i.test(c.title)), "iphone stays a required word")
	const phone = filterCards(cards, "telefon")
	assert.ok(phone.length === cards.length, "a generic-only term matches everything")
	assert.ok(filterCards(cards, "telefon xzy model").length === 0, "unknown model words match nothing")
})

test("accessories are dropped even when their name matches the term", () => {
	const cards: Card[] = [
		{ id: "1", title: "Sony daljinski upravljač PlayStation 5", price: 3615, shopId: "s", shopName: "S", url: "https://www.eponuda.com/x", image: null },
		{ id: "2", title: "Sony PlayStation 5 konzola", price: 55000, shopId: "s", shopName: "S", url: "https://www.eponuda.com/y", image: null },
	]
	const matched = filterCards(cards, "playstation 5")
	assert.equal(matched.length, 1)
	assert.match(matched[0]!.title, /konzola/)
})

test("the live page is not mistaken for a Cloudflare challenge", async () => {
	assert.ok(!isChallenge(await category))
})

test("the customer profile is a coherent Chrome header set", () => {
	assert.match(CUSTOMER_HEADERS["user-agent"]!, /Chrome\/131/)
	assert.ok(CUSTOMER_HEADERS["sec-ch-ua"])
	assert.ok(CUSTOMER_HEADERS["sec-fetch-mode"])
	assert.ok(CUSTOMER_HEADERS["accept-language"])
})
