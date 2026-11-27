import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { test } from "node:test"
import { createTehnomediaScout, parseTehnomediaProduct, parseTehnomediaSearch } from "./tehnomedia"
import { ScoutBlocked } from "./types"

const page = (name: string) => readFile(resolve(process.cwd(), "data/pages/tehnomedia", name), "utf8")
const productUrl = "https://www.tehnomedia.rs/proizvod/samsung-galaxy-xcover7-6gb-128gb-black-sm-g556bzkdeec"
const now = "2026-11-27T12:00:00.000Z"

test("the saved search page yields unique product URLs in order, XCover7 first", async () => {
	const urls = parseTehnomediaSearch(await page("search-telefon.html"))
	assert.ok(urls.length >= 10, `only ${urls.length} URLs`)
	assert.equal(new Set(urls).size, urls.length)
	assert.ok(urls.every((u) => u.startsWith("https://www.tehnomedia.rs/proizvod/")))
	assert.equal(urls[0], productUrl)
})

test("the saved product page gives title, price, image, stock and delivery", async () => {
	const candidate = parseTehnomediaProduct(await page("product-samsung-xcover7.html"), productUrl, now)
	assert.ok(candidate)
	assert.match(candidate.title, /XCover7/)
	assert.equal(candidate.price, 39999)
	assert.match(candidate.image ?? "", /^https:\/\//)
	assert.equal(candidate.inStock, true)
	assert.equal(candidate.delivery, 0)
	assert.equal(candidate.site, "tehnomedia")
	assert.equal(candidate.shop, "Tehnomedia")
	assert.equal(candidate.url, productUrl)
	assert.equal(candidate.checkedAt, now)
})

test("a page without JSON-LD has no candidate", () => {
	assert.equal(parseTehnomediaProduct("<html><body>No structured data</body></html>", productUrl, now), null)
})

test("the scout builds the search URL with the given range params only", async () => {
	const urls: string[] = []
	const scout = createTehnomediaScout(async (url) => {
		urls.push(url)
		return ""
	})
	await scout.search("telefon", {})
	await scout.search("telefon do 40k", { maxPrice: 40000 })
	await scout.search("telefon od 10k", { minPrice: 10000, maxPrice: 40000 })
	assert.deepEqual(urls, [
		"https://www.tehnomedia.rs/search/find.html?rec=telefon",
		"https://www.tehnomedia.rs/search/find.html?rec=telefon%20do%2040k&priceTo=40000",
		"https://www.tehnomedia.rs/search/find.html?rec=telefon%20od%2010k&priceFrom=10000&priceTo=40000",
	])
})

test("the scout reads the product page through the injected fetcher", async () => {
	const html = await page("product-samsung-xcover7.html")
	const scout = createTehnomediaScout(async () => html)
	const candidate = await scout.read(productUrl)
	assert.equal(candidate?.price, 39999)
	assert.equal(candidate?.url, productUrl)
})

test("a challenge page is reported as blocked", async () => {
	const scout = createTehnomediaScout(async () => "<html><title>Just a moment...</title></html>")
	await assert.rejects(() => scout.search("telefon", {}), ScoutBlocked)
})
