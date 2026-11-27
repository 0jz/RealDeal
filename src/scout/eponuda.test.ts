import { parseEponudaCards } from "../sources/eponuda"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { createEponudaScout, parseEponudaProduct } from "./eponuda"

const saved = (name: string): string => readFileSync(new URL(`../../data/pages/eponuda/${name}`, import.meta.url), "utf8")
const categoryHtml = saved("category-mobilni-telefoni.html")
const productHtml = saved("product-samsung-a57.html")
const productUrl = "https://www.eponuda.com/samsung-galaxy-cene/samsung-a57-5g-256gb-gray-cena-43374042"
const now = "2026-11-27T12:00:00.000Z"

const ldPage = (data: unknown): string =>
	`<html><head><script type="application/ld+json">${JSON.stringify(data)}</script></head></html>`

test("the saved product page yields the aggregate price, shop count and https image", () => {
	const candidate = parseEponudaProduct(productHtml, productUrl, now)
	assert.ok(candidate)
	assert.equal(candidate.title, "Samsung Galaxy A57 5G 8GB/256GB Gray")
	assert.equal(candidate.price, 44900)
	assert.equal(candidate.inStock, true)
	assert.match(candidate.shop, /eponuda · \d+ prodavnica/)
	assert.ok(candidate.image?.startsWith("https://"))
	assert.equal(candidate.delivery, null)
	assert.equal(candidate.site, "eponuda")
	assert.equal(candidate.url, productUrl)
	assert.equal(candidate.checkedAt, now)
})

test("a page without a Product JSON-LD block is not a candidate", () => {
	assert.equal(parseEponudaProduct(ldPage({ "@type": "BreadcrumbList", name: "Telefoni" }), productUrl, now), null)
	assert.equal(parseEponudaProduct("<html></html>", productUrl, now), null)
})

test("a missing or non-positive lowPrice is not a candidate", () => {
	assert.equal(parseEponudaProduct(ldPage({ "@type": "Product", name: "A57", offers: {} }), productUrl, now), null)
	assert.equal(parseEponudaProduct(ldPage({ "@type": "Product", name: "A57", offers: { lowPrice: 0 } }), productUrl, now), null)
	assert.equal(parseEponudaProduct(ldPage({ "@type": "Product", name: "A57", offers: { lowPrice: "abc" } }), productUrl, now), null)
})

test("availability and a missing offerCount are read without guessing", () => {
	const page = (availability?: string, offerCount?: number) => ldPage({
		"@type": "Product",
		name: "A57",
		offers: { lowPrice: 44900, availability, offerCount },
	})
	assert.equal(parseEponudaProduct(page("http://schema.org/OutOfStock"), productUrl, now)?.inStock, false)
	assert.equal(parseEponudaProduct(page("http://schema.org/LimitedAvailability"), productUrl, now)?.inStock, true)
	assert.equal(parseEponudaProduct(page(undefined), productUrl, now)?.inStock, null)
	assert.equal(parseEponudaProduct(page("http://schema.org/InStock", 30), productUrl, now)?.shop, "eponuda · 30 prodavnica")
	assert.equal(parseEponudaProduct(page("http://schema.org/InStock"), productUrl, now)?.shop, "eponuda")
})

test("search fetches one category page and returns only internal product URLs", async () => {
	const asked: string[] = []
	const scout = createEponudaScout(async (url) => {
		asked.push(url)
		return categoryHtml
	})
	const urls = await scout.search("iphone 15", { maxPrice: 200000 })
	assert.deepEqual(asked, ["https://www.eponuda.com/mobilni-telefoni-cene"])
	assert.ok(urls.length > 0)
	assert.ok(urls.every(url => /-cena-\d+$/.test(url)))
	assert.equal(new Set(urls).size, urls.length)
})

test("search filters the card prices before applying the eight URL limit", async () => {
	const scout = createEponudaScout(async () => categoryHtml)
	const urls = await scout.search("mobilni telefon", { minPrice: 90000 })
	assert.ok(urls.length <= 8)
	const cards = parseEponudaCards(categoryHtml)
	assert.deepEqual(urls, cards.filter(c => c.price >= 90000 && /-cena-\d+$/.test(c.url)).slice(0, 8).map(c => c.url))
	assert.ok(urls.every(url => /-cena-\d+$/.test(url)))
})

test("an unmapped term needs no fetch", async () => {
	let fetches = 0
	const scout = createEponudaScout(async () => {
		fetches++
		return categoryHtml
	})
	assert.deepEqual(await scout.search("zimska jakna", {}), [])
	assert.equal(fetches, 0)
})

test("read uses the injected fetcher for the product page", async () => {
	const asked: string[] = []
	const scout = createEponudaScout(async (url) => {
		asked.push(url)
		return productHtml
	})
	const candidate = await scout.read(productUrl)
	assert.deepEqual(asked, [productUrl])
	assert.equal(candidate?.price, 44900)
	assert.ok(candidate?.checkedAt)
})


test("a tiny price limit does not open expensive product pages", async () => {
	const scout = createEponudaScout(async () => categoryHtml)
	assert.deepEqual(await scout.search("telefon", { maxPrice: 1 }), [])
})
