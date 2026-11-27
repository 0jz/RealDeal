import assert from "node:assert/strict"
import { test } from "node:test"
import { barcodeKey, normalizeBarcode } from "./code"
import { createBarcodeLookup, parseOpenFoodFacts, parseUpcItemDb } from "./lookup"

const ean = "5099206061309"
const item = { ean, title: "Logitech C920 Webcam", brand: "Logitech", category: "Webcams", images: ["http://example.com/unsafe.jpg", "https://example.com/c920.jpg"] }
const found = { code: "OK", items: [item] }
const empty = { code: "OK", items: [] }

test("GTIN validation preserves leading zeros and verifies the check digit for each length", () => {
	for (const code of ["96385074", "036000291452", "3017620422003", "10012345000017"]) assert.equal(normalizeBarcode(code), code)
	assert.equal(normalizeBarcode("0 36000-29145 2"), "036000291452")
	for (const code of [null, 36000291452, "", "00000000", "3017620422004", "1234567", "123456789", "https://example.com/3017620422003", "5099206061309<script>"]) assert.equal(normalizeBarcode(code), null)
	assert.equal(barcodeKey("036000291452"), barcodeKey("0036000291452"))
})

test("lookup only accepts the requested barcode and returns attribution, never database prices", () => {
	const parsed = parseUpcItemDb({ ...found, items: [{ ...item, ean: "3017620422003" }, { ...item, lowest_recorded_price: 1 }] }, ean)
	assert.equal(parsed?.title, item.title)
	assert.equal(parsed?.image, "https://example.com/c920.jpg")
	assert.equal(parsed?.source.name, "UPCitemdb")
	assert.ok(!("price" in parsed!))
	assert.equal(parseUpcItemDb({ ...found, items: [{ ...item, ean: "3017620422003" }] }, ean), null)
	assert.equal(parseUpcItemDb({ code: "OK", items: [{ upc: "036000291452", title: "Product" }] }, "0036000291452")?.title, "Product")
	assert.throws(() => parseUpcItemDb({ code: "TOO_MANY_REQUESTS" }, ean))
})

test("Open Food Facts requires a matching barcode and a real product name", () => {
	const data = { status: 1, code: "3017620422003", product: { code: "3017620422003", product_name: "Nutella", brands: "Ferrero", image_front_small_url: "javascript:alert(1)" } }
	assert.equal(parseOpenFoodFacts(data, data.code)?.title, "Nutella")
	assert.equal(parseOpenFoodFacts(data, data.code)?.image, null)
	assert.equal(parseOpenFoodFacts(data, ean), null)
	assert.equal(parseOpenFoodFacts({ status: 0 }, ean), null)
	assert.throws(() => parseOpenFoodFacts({}, ean))
})

test("invalid codes cause no provider calls; concurrent duplicate lookups share one call and cache expires", async () => {
	let calls = 0; let time = 0
	const lookup = createBarcodeLookup(async () => { calls++; return found }, () => time)
	await assert.rejects(lookup("bad")); assert.equal(calls, 0)
	const results = await Promise.all([lookup(ean), lookup(ean)])
	assert.equal(results[0].status, "found"); assert.equal(calls, 1)
	await lookup(ean); assert.equal(calls, 1)
	time = 3_600_001; await lookup(ean); assert.equal(calls, 2)
})

test("a provider outage falls back, but never becomes a definitive not-found or a cached outage", async () => {
	const food = { status: 1, product: { code: ean, product_name: "Fallback item" } }
	assert.equal((await createBarcodeLookup(async url => { if (url.includes("upcitemdb")) throw new Error("offline"); return food })(ean)).status, "found")
	let calls = 0
	const partial = createBarcodeLookup(async url => { calls++; if (url.includes("upcitemdb")) throw new Error("quota"); return { status: 0 } })
	assert.equal((await partial(ean)).status, "unavailable")
	assert.equal((await partial(ean)).status, "unavailable"); assert.equal(calls, 4)
	const missing = createBarcodeLookup(async url => url.includes("upcitemdb") ? empty : { status: 0 })
	assert.equal((await missing(ean)).status, "not_found")
})
