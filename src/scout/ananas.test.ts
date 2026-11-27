import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { createAnanasScout, parseAnanasProduct, parseAnanasSearch } from "./ananas"
import { ScoutBlocked } from "./types"

const saved = (name: string): string => readFileSync(new URL(`../../data/pages/ananas/${name}`, import.meta.url), "utf8")
const searchHtml = saved("search-zimska-jakna.html")
const productHtml = saved("product-jj-rebel-jakna.html")
const productUrl = "https://ananas.rs/proizvod/jj-rebel-muska-jakna-12267842-maslinasta/4969899"
const now = "2026-11-27T12:00:00.000Z"

const ldPage = (data: unknown): string => `<html><head><script type="application/ld+json">${JSON.stringify(data)}</script></head></html>`

test("the saved search page yields unique absolute URLs in page order", () => {
	const urls = parseAnanasSearch(searchHtml)
	assert.ok(urls.length >= 10, `only ${urls.length} URLs`)
	assert.equal(urls[0], productUrl)
	assert.ok(urls.includes(productUrl))
	assert.equal(new Set(urls).size, urls.length)
	assert.ok(urls.every((url) => url.startsWith("https://ananas.rs/proizvod/")))
})

test("the saved product page yields the real price, picture and stock", () => {
	const candidate = parseAnanasProduct(productHtml, productUrl, now)
	assert.ok(candidate)
	assert.match(candidate.title, /JJ REBEL/)
	assert.equal(candidate.price, 2599)
	assert.ok(candidate.image?.startsWith("https://"))
	assert.equal(candidate.inStock, true)
	assert.equal(candidate.site, "ananas")
	assert.equal(candidate.url, productUrl)
	assert.equal(candidate.checkedAt, now)
	assert.equal(candidate.delivery, null)
	assert.equal(candidate.shop, "Ananas · Spark")
	assert.match(candidate.category ?? "", /Muške jakne/)
})

test("a page without a Product JSON-LD block is not a candidate", () => {
	const html = ldPage({ "@type": "BreadcrumbList", name: "Jakne" })
	assert.equal(parseAnanasProduct(html, productUrl, now), null)
	assert.equal(parseAnanasProduct("<html><body>no data</body></html>", productUrl, now), null)
})

test("a Product with a non-numeric price is dropped", () => {
	const html = ldPage({
		"@type": "Product",
		name: "Test jakna",
		image: ["https://static.ananas.rs/test.jpg"],
		offers: { price: "abc", priceCurrency: "RSD", availability: "https://schema.org/InStock" },
	})
	assert.equal(parseAnanasProduct(html, productUrl, now), null)
})

test("a non-RSD price is dropped", () => {
	const html = ldPage({
		"@type": "Product",
		name: "Test jakna",
		offers: { price: 2599, priceCurrency: "EUR" },
	})
	assert.equal(parseAnanasProduct(html, productUrl, now), null)
})

test("the scout calls only the encoded HTML search URL", async () => {
	const asked: string[] = []
	const scout = createAnanasScout(async (url) => {
		asked.push(url)
		return searchHtml
	})
	const urls = await scout.search("đ ženska jakna & kapuljača", { maxPrice: 8000 })
	assert.deepEqual(asked, [`https://ananas.rs/search?query=${encodeURIComponent("đ ženska jakna & kapuljača")}`])
	assert.ok(!urls.includes(productUrl), "unrelated men’s jacket is not a match for this query")
})

test("the scout reads a product page through the injected fetcher", async () => {
	const asked: string[] = []
	const scout = createAnanasScout(async (url) => {
		asked.push(url)
		return productHtml
	})
	const candidate = await scout.read(productUrl)
	assert.deepEqual(asked, [productUrl])
	assert.equal(candidate?.price, 2599)
	assert.ok(candidate?.checkedAt)
})

test("a challenge or a 403 becomes ScoutBlocked, never a parsed listing", async () => {
	const challenge = createAnanasScout(async () => "<html><title>Just a moment...</title><body>cf-chl</body></html>")
	await assert.rejects(challenge.read(productUrl), ScoutBlocked)
	const forbidden = createAnanasScout(async () => {
		throw new Error("HTTP 403 for https://ananas.rs/search?query=jakna")
	})
	await assert.rejects(forbidden.search("jakna", {}), ScoutBlocked)
})


test("live phone search cards exclude toys and ads and supply all three price bands", () => {
	const html = saved("search-telefon-cards.html")
	const groups = [[1,33333], [33334,66666], [66667,100000]].map(([minPrice, maxPrice]) => parseAnanasSearch(html, { minPrice, maxPrice }, "phone"))
	assert.deepEqual(groups.map(g => g.length), [1, 1, 1])
	assert.match(groups[0][0], /redmi-17-4g/)
	assert.match(groups[1][0], /redmi-note-17-pro/)
	assert.match(groups[2][0], /galaxy-s26/)
	assert.ok(!groups.flat().some(url => /lego|runetto/.test(url)))
	assert.ok(parseAnanasSearch(html, {}, "LEGO telefon").some(url => url.includes("lego")), "an explicitly requested toy remains searchable")
})
