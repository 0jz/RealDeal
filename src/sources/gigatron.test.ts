import assert from "node:assert/strict"
import { test } from "node:test"
import { parseProduct, slugMatches, slugTokens } from "./gigatron"

const url = "https://gigatron.rs/proizvod/apple-iphone-15-pro-128gb-natural-titanium-0194253401193"

test("slug tokens drop the trailing EAN", () => {
	assert.deepEqual(slugTokens(url), ["apple", "iphone", "15", "pro", "128gb", "natural", "titanium"])
})

test("every term word must start a slug token", () => {
	const t = slugTokens(url)
	assert.ok(slugMatches(t, "iPhone 15 Pro"))
	assert.ok(slugMatches(t, "iphone 15 pro 128"))
	assert.ok(!slugMatches(t, "iphone 15 pro max"))
	assert.ok(!slugMatches(t, "iphone 1940")) // digits of the EAN never count
	assert.ok(!slugMatches(t, ""))
})

test("accessory slugs are skipped before fetching", () => {
	const caseUrl = "https://gigatron.rs/proizvod/apple-zastitna-maska-sa-magsafe-za-iphone-15-pro-clear-mt223zm-a-194253940326"
	assert.ok(!slugMatches(slugTokens(caseUrl), "iphone 15 pro"))
})

const page = (offers: object) =>
	`<html><script type="application/ld+json">{"@type":"BreadcrumbList"}</script>` +
	`<script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: "Apple iPhone 15 Pro 128GB", productID: "42", offers })}</script></html>`

test("parses name, price and stock from Product JSON-LD", () => {
	const l = parseProduct(page({ price: 129999, availability: "https://schema.org/InStock" }), url)
	assert.equal(l?.title, "Apple iPhone 15 Pro 128GB")
	assert.equal(l?.price, 129999)
	assert.equal(l?.id, "42")
	assert.equal(l?.shopId, "gigatron")
})

test("skips out-of-stock and unpriced products", () => {
	assert.equal(parseProduct(page({ price: 129999, availability: "https://schema.org/OutOfStock" }), url), null)
	assert.equal(parseProduct(page({ price: 0 }), url), null)
	assert.equal(parseProduct("<html></html>", url), null)
})
