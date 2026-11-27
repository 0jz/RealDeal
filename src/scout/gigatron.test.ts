import assert from "node:assert/strict"
import { test } from "node:test"
import { createGigatronScout } from "./gigatron"
import { ScoutBlocked } from "./types"

const url = "https://gigatron.rs/proizvod/apple-iphone-15-pro-128gb-natural-titanium-0194253401193"

const productPage = (offers: object) =>
	`<html><script type="application/ld+json">${JSON.stringify({
		"@type": "Product",
		name: "Apple iPhone 15 Pro 128GB",
		productID: "42",
		image: ["https://gigatron.rs/img/iphone.jpg", "http://insecure/img/other.jpg"],
		offers,
	})}</script></html>`

const inStock = productPage({ price: 129999, availability: "https://schema.org/InStock" })

test("the scout maps a JSON-LD Product into a candidate through the stubbed fetcher", async () => {
	const urls: string[] = []
	const scout = createGigatronScout(async (u) => {
		urls.push(u)
		return inStock
	})
	const candidate = await scout.read(url)
	assert.deepEqual(urls, [url])
	assert.equal(candidate?.site, "gigatron")
	assert.equal(candidate?.shop, "Gigatron")
	assert.equal(candidate?.title, "Apple iPhone 15 Pro 128GB")
	assert.equal(candidate?.price, 129999)
	assert.equal(candidate?.inStock, true)
	assert.equal(candidate?.delivery, null)
	assert.equal(candidate?.image, "https://gigatron.rs/img/iphone.jpg")
	assert.equal(candidate?.url, url)
	assert.match(candidate?.checkedAt ?? "", /^\d{4}-\d{2}-\d{2}T/)
})

test("a page with no clean in-stock price is not a candidate", async () => {
	const scout = createGigatronScout(async () => productPage({ price: 129999, availability: "https://schema.org/OutOfStock" }))
	assert.equal(await scout.read(url), null)
})

test("a challenge page is reported as blocked", async () => {
	const scout = createGigatronScout(async () => "<html><title>Attention Required! | Cloudflare</title></html>")
	await assert.rejects(() => scout.read(url), ScoutBlocked)
})
