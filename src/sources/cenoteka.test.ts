import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { test } from "node:test"
import { filterTiles, parseCenotekaOffers, parseCenotekaTiles, type Tile } from "./cenoteka"
import { isChallenge } from "./customer"

const dir = (name: string) => readFile(resolve(process.cwd(), "data/pages/cenoteka", name), "utf8")

test("parses the product tiles of a category page", async () => {
	const tiles = parseCenotekaTiles(await dir("category-apple-phones.html"))
	assert.ok(tiles.length >= 12, `expected the page's tiles, got ${tiles.length}`)
	assert.ok(tiles.every((t) => t.slug && t.price > 0))
	assert.ok(tiles.some((t) => t.name.includes("iPhone")))
	assert.ok(tiles.every((t) => !t.image || t.image!.startsWith("https://api.cenoteka.rs/")))
})

test("filters tiles by every term word except generic category words", async () => {
	const tiles = parseCenotekaTiles(await dir("category-apple-phones.html"))
	const matched = filterTiles(tiles, "iphone 15")
	assert.ok(matched.length >= 1)
	assert.ok(matched.every((t) => /iphone/i.test(t.name)), "iphone stays a required word")
	assert.ok(filterTiles(tiles, "telefon").length === tiles.length, "a generic-only term matches everything")
	assert.ok(filterTiles(tiles, "telefon xzy model").length === 0, "unknown model words match nothing")
})

test("parses per-shop offers from a product page without calling /redirect/", async () => {
	const html = await dir("product-iphone-17-pro.html")
	const offers = parseCenotekaOffers(html, "https://cenoteka.rs/p/example/")
	assert.ok(offers.length >= 3, `expected several shops, got ${offers.length}`)
	assert.ok(offers.every((o) => o.price > 1000))
	assert.ok(offers.every((o) => o.shopId))
	assert.ok(offers.every((o) => o.shopName))
	// The link must be the shop's real URL decoded from the redirect parameter, not /redirect/ itself.
	assert.ok(offers.every((o) => !o.url.includes("/redirect/")))
	assert.ok(offers.some((o) => o.url.startsWith("https://")))
})

test("accessories are dropped even when their name matches the term", () => {
	const tiles: Tile[] = [
		{ slug: "a", name: "Sony daljinski upravljač PlayStation 5", price: 3615, image: null },
		{ slug: "b", name: "Sony PlayStation 5 konzola", price: 55000, image: null },
	]
	const matched = filterTiles(tiles, "playstation 5")
	assert.equal(matched.length, 1)
	assert.match(matched[0]!.name, /konzola/)
})

test("the live pages are not mistaken for a Cloudflare challenge", async () => {
	assert.ok(!isChallenge(await dir("category-apple-phones.html")))
	assert.ok(!isChallenge(await dir("product-iphone-17-pro.html")))
})
