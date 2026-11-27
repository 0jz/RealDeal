import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { noteBlocked } from "../sources/customer"
import { ScoutBlocked } from "./types"
import { createCenotekaScout, parseCenotekaProduct } from "./cenoteka"

const saved = (name: string): string => readFileSync(new URL(`../../data/pages/cenoteka/${name}`, import.meta.url), "utf8")
const categoryHtml = saved("category-apple-phones.html")
const productHtml = saved("product-iphone-17-pro.html")
const productUrl = "https://cenoteka.rs/p/apple-iphone-17-pro-12-256gb-deep-blue-mg8j4sx-a/"
const now = "2026-11-27T12:00:00.000Z"

test("the saved product page yields the cheapest offer and the og metadata", () => {
	const candidate = parseCenotekaProduct(productHtml, productUrl, now)
	assert.ok(candidate)
	assert.equal(candidate.title, "APPLE iPhone 17 Pro 12/256GB Deep Blue (MG8J4SX/A) - Cene i Akcije")
	assert.equal(candidate.price, 159790)
	assert.equal(candidate.shop, "Cenoteka · SOPING")
	assert.ok(candidate.image?.startsWith("https://"))
	assert.equal(candidate.delivery, null)
	assert.equal(candidate.inStock, true)
	assert.equal(candidate.site, "cenoteka")
	assert.equal(candidate.url, productUrl)
	assert.equal(candidate.checkedAt, now)
})

test("a page without offers is not a candidate", () => {
	assert.equal(parseCenotekaProduct("<html><head><meta property=\"og:title\" content=\"Phone\"></head></html>", productUrl, now), null)
})

test("an insecure og:image is not used", () => {
	const html = productHtml.replace(/<meta property="og:image" content="https:[^"]+"/, '<meta property="og:image" content="http://x/y.jpg">')
	assert.equal(parseCenotekaProduct(html, productUrl, now)?.image, null)
})

test("search tries the brand category page once and returns /p/ URLs", async () => {
	const asked: string[] = []
	const scout = createCenotekaScout(async (url) => {
		asked.push(url)
		return categoryHtml
	})
	const urls = await scout.search("iphone 15", { maxPrice: 60000 })
	assert.deepEqual(asked, ["https://cenoteka.rs/b/apple/mobilni-telefoni-cene/"])
	assert.ok(urls.length > 0)
	assert.ok(urls.every(url => /^https:\/\/cenoteka\.rs\/p\/[^/]+\/$/.test(url)))
	assert.equal(new Set(urls).size, urls.length)
})

test("search falls back to the plain category page when the brand page has no tiles", async () => {
	const asked: string[] = []
	const scout = createCenotekaScout(async (url) => {
		asked.push(url)
		return url.includes("/b/") ? "<html></html>" : categoryHtml
	})
	const urls = await scout.search("iphone 15", {})
	assert.deepEqual(asked, ["https://cenoteka.rs/b/apple/mobilni-telefoni-cene/", "https://cenoteka.rs/mobilni-telefoni-cene/"])
	assert.ok(urls.length > 0)
})

test("an unmapped term needs no fetch", async () => {
	let fetches = 0
	const scout = createCenotekaScout(async () => {
		fetches++
		return categoryHtml
	})
	assert.deepEqual(await scout.search("zimska jakna", {}), [])
	assert.equal(fetches, 0)
})

test("read uses the injected fetcher for the product page", async () => {
	const asked: string[] = []
	const scout = createCenotekaScout(async (url) => {
		asked.push(url)
		return productHtml
	})
	const candidate = await scout.read(productUrl)
	assert.deepEqual(asked, [productUrl])
	assert.equal(candidate?.price, 159790)
	assert.ok(candidate?.checkedAt)
})

test("an empty page without a challenge is not a block", async () => {
	const scout = createCenotekaScout(async () => null)
	assert.deepEqual(await scout.search("laptop", {}), [])
})

// Last in the file: noteBlocked puts the host in a 10-minute cool-down for this process.
test("a challenged host makes the scout report blocked, not an empty ok", async () => {
	noteBlocked("https://cenoteka.rs/laptopovi-cene/")
	const scout = createCenotekaScout(async () => null)
	await assert.rejects(scout.search("laptop", {}), ScoutBlocked)
	await assert.rejects(scout.read(productUrl), ScoutBlocked)
})
