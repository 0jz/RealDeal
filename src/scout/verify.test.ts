import assert from "node:assert/strict"
import { test } from "node:test"
import { verifyListing, verifyRanked, type VerifyDeps } from "./verify"
import type { ScoutListing } from "./types"

const listing = (n: number, over: Partial<ScoutListing> = {}): ScoutListing => ({
	site: "ananas",
	shop: "Ananas",
	title: `Winter jacket ${n}`,
	price: 5000 + n,
	delivery: null,
	inStock: true,
	url: `https://ananas.rs/proizvod/jakna-${n}`,
	image: `https://ananas.rs/slike/jakna-${n}.jpg`,
	checkedAt: "2026-11-26T10:00:00.000Z",
	score: 0.9,
	reason: "matches",
	verified: false,
	...over,
})

const now = () => "2026-11-27T12:00:00.000Z"

/** Deps where every page still loads at its stored price and every image is a JPEG. */
function stubDeps(over: Partial<VerifyDeps> = {}): VerifyDeps {
	return {
		reread: async (l) => ({ site: l.site, shop: l.shop, title: l.title, price: l.price, delivery: null, inStock: true, url: l.url, image: l.image, checkedAt: now() }),
		contentType: async () => "image/jpeg",
		now,
		...over,
	}
}

test("a listing whose page, price and picture check out passes with a fresh checkedAt", async () => {
	const out = await verifyListing(listing(1), stubDeps())
	assert.equal(out.ok, true)
	if (!out.ok) return
	assert.equal(out.listing.verified, true)
	assert.equal(out.listing.checkedAt, now())
	assert.equal(out.listing.image, "https://ananas.rs/slike/jakna-1.jpg")
})

test("a fresh page without a stock assertion does not retain an earlier in-stock claim", async () => {
	const out = await verifyListing(listing(1), stubDeps({ reread: async l => ({ ...l, inStock: null }) }))
	assert.ok(out.ok)
	assert.equal(out.listing.inStock, null)
})

test("a price change drops the listing and the next one moves up", async () => {
	const cheaperNow = stubDeps({
		reread: async (l) => ({ site: l.site, shop: l.shop, title: l.title, price: l.price === 5001 ? 4900 : l.price, delivery: null, inStock: true, url: l.url, image: l.image, checkedAt: now() }),
	})
	const ranked = [listing(1), listing(2)]
	const { kept, dropped } = await verifyRanked(ranked, cheaperNow, 1)
	assert.deepEqual(
		dropped.map((d) => (d.ok ? "" : d.why)),
		["price changed from 5001 to 4900 RSD"],
	)
	assert.equal(kept.length, 1)
	assert.equal(kept[0]?.url, "https://ananas.rs/proizvod/jakna-2")
})

test("a wrong picture type keeps the listing with image null", async () => {
	const out = await verifyListing(listing(1), stubDeps({ contentType: async () => "text/html; charset=utf-8" }))
	assert.equal(out.ok, true)
	if (!out.ok) return
	assert.equal(out.listing.image, null)
	assert.equal(out.listing.verified, true)
})

test("a picture that cannot be checked is dropped to null, never replaced by another listing's", async () => {
	const out = await verifyListing(listing(1), stubDeps({ contentType: async () => null }))
	assert.ok(out.ok)
	if (out.ok) assert.equal(out.listing.image, null)
})

test("no image on the listing means no picture check", async () => {
	let asked = 0
	const out = await verifyListing(listing(1, { image: null }), stubDeps({ contentType: async () => (asked++, "image/png") }))
	assert.ok(out.ok)
	assert.equal(asked, 0)
})

test("a reread that throws drops the listing as page no longer loads", async () => {
	const deps = stubDeps({
		reread: async () => {
			throw new Error("HTTP 503")
		},
	})
	const { kept, dropped } = await verifyRanked([listing(1)], deps)
	assert.deepEqual(kept, [])
	assert.equal(dropped[0]?.ok, false)
	assert.equal(dropped[0]?.ok === false && dropped[0].why, "page no longer loads")
})

test("a reread that finds no candidate also drops the listing", async () => {
	const out = await verifyListing(listing(1), stubDeps({ reread: async () => null }))
	assert.equal(out.ok === false && out.why, "page no longer loads")
})

test("stops reading once `slots` listings have passed", async () => {
	let rereads = 0
	const deps = stubDeps({
		reread: async (l) => (rereads++, { site: l.site, shop: l.shop, title: l.title, price: l.price, delivery: null, inStock: true, url: l.url, image: l.image, checkedAt: now() }),
	})
	const ranked = [1, 2, 3, 4, 5].map((n) => listing(n))
	const { kept, dropped } = await verifyRanked(ranked, deps, 2)
	assert.equal(kept.length, 2)
	assert.equal(dropped.length, 0)
	assert.equal(rereads, 2)
})

test("cancellation returns what is verified so far and starts no new batch", async () => {
	let calls = 0
	const fresh = stubDeps()
	const deps = stubDeps({ reread: async (l) => (l.url.endsWith("-1") ? null : fresh.reread(l)) })
	const ranked = [1, 2, 3].map((n) => listing(n))
	const { kept, dropped } = await verifyRanked(ranked, deps, 2, () => ++calls > 1)
	assert.deepEqual(
		kept.map((l) => l.url),
		["https://ananas.rs/proizvod/jakna-2"],
	)
	assert.equal(dropped.length, 1)
})

test("verifies a batch in parallel and keeps rank order", async () => {
	let open = 0
	let most = 0
	const fresh = stubDeps()
	const deps = stubDeps({
		reread: async (l) => {
			open++
			most = Math.max(most, open)
			await new Promise((r) => setTimeout(r, 5 * (6 - Number(l.url.slice(-1)))))
			open--
			return fresh.reread(l)
		},
	})
	const ranked = [1, 2, 3, 4, 5].map((n) => listing(n))
	const { kept } = await verifyRanked(ranked, deps, 3)
	assert.equal(most, 3)
	assert.deepEqual(kept.map((l) => l.url.slice(-1)), ["1", "2", "3"])
})


test("verification rejects unavailable listings and changed delivery costs", async () => {
	for (const change of [{ inStock: false }, { delivery: 500 }]) {
		const item = listing(1)
		const outcome = await verifyListing(item, stubDeps({ reread: async l => ({ ...l, ...change }) }))
		assert.equal(outcome.ok, false)
	}
})
