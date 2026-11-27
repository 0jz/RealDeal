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
	assert.match(candidate.category ?? "", /Smart mobilni telefoni/)
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


test("search filters accessory cards and applies the range even if the site ignores URL filters", async () => {
	const html = await page("search-telefon.html")
	const urls = parseTehnomediaSearch(html, { minPrice: 33334, maxPrice: 66666 }, "phone")
	assert.ok(urls.includes(productUrl))
	assert.ok(!urls.some(url => url.includes("case")))
	assert.deepEqual(parseTehnomediaSearch(html, { maxPrice: 1 }, "phone"), [])
})


test("an ambiguous I-PHONE cable preserves the shop category for relevance checks", async () => {
	const candidate = parseTehnomediaProduct(await page("product-cable-jsonld.html"), "https://www.tehnomedia.rs/proizvod/max-mobile-i-phone-5-6-7-8-gc-46-beli", now)
	assert.equal(candidate?.price, 599)
	assert.equal(candidate?.category, "IT & Gaming > Kablovi i adapteri")
})

test("live HP laptop cards need the category when their title omits laptop", async () => {
	const urls = parseTehnomediaSearch(await page("search-laptop-cards.html"), { maxPrice: 100000 }, "laptop")
	assert.equal(urls.length, 3)
	assert.ok(urls.some(u => u.includes("hp-250")))
})
