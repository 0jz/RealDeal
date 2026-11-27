import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { createComputersScout, parseComputersProduct, parseComputersSearch } from "./computers"
import { ScoutBlocked } from "./types"

const saved = (file: string) => readFileSync(new URL(`../../data/pages/computers/${file}`, import.meta.url), "utf8")
const product = saved("laptop-product.html")
const cards = saved("laptop-cards.html")
const url = "https://www.computers.rs/artikal/asus-x540nagq005-90nb0hg1m02290-156-hd-intel-celeron-n3350-4gb-500gb-intel-hd-crni"

test("live Computers.rs cards exclude unavailable products and enforce range and model", () => {
	const found = parseComputersSearch(cards, "laptop", { maxPrice: 33333 })
	assert.ok(found.length > 0)
	assert.ok(found.every(u => u.startsWith("https://www.computers.rs/artikal/")))
	assert.ok(!found.some(u => u.includes("1wy47ea")), "unavailable HP card")
	assert.deepEqual(parseComputersSearch(cards, "laptop", { minPrice: 33334 }), [])
	assert.deepEqual(parseComputersSearch(cards, "MacBook M5", {}), [])
})

test("product price uses the payable price, not MPC; a cart button does not prove stock", () => {
	const item = parseComputersProduct(product, url, "2026-11-27T14:00:00Z")
	assert.ok(item)
	assert.equal(item.price, 27625)
	assert.equal(item.inStock, null)
	assert.equal(item.delivery, null)
	assert.match(item.category!, /Laptopovi i oprema > Laptop$/)
	assert.match(item.image!, /^https:/)
	assert.equal(parseComputersProduct(product.replace("27.625", "unknown"), url, "now"), null)
	assert.equal(parseComputersProduct(product.replace("Dodaj u korpu", "Nije dostupno"), url, "now")?.inStock, false)
	assert.equal(parseComputersProduct("<h1>missing product</h1>", url, "now"), null)
})

test("scout uses bounded same-category public links and skips other categories", async () => {
	const seen: string[] = []
	const category = "https://www.computers.rs/artikli/laptopovi-i-tableti/laptopovi-i-oprema/laptop/0/0/0-0"
	const scout = createComputersScout(async u => {
		seen.push(u)
		return `${cards}<a href="${category}?page=2">2</a><a href="${category}?page=2">Next</a><a href="${category}?page=3">3</a><a href="${category}?page=4">4</a><a href="https://other.test/?page=2">bad</a>`
	})
	assert.deepEqual(await scout.search("phone", {}), [])
	assert.equal(seen.length, 0)
	await scout.search("laptop", {})
	assert.deepEqual(seen, [category, `${category}?page=2`, `${category}?page=3`])
	assert.equal(await scout.read("https://other.test/artikal/example"), null)
	await assert.rejects(createComputersScout(async () => { throw new Error("HTTP 403") }).search("laptop", {}), ScoutBlocked)
})
