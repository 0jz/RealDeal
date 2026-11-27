import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"
import { clearScoutCache, runScouts, type RunDeps, type RunEvent } from "./run"
import { ScoutBlocked } from "./types"
import type { ScoutCandidate, ScoutResult, ScoutSite, ScoutWant, ShopScout } from "./types"
import type { VerifyDeps } from "./verify"

beforeEach(() => clearScoutCache())

const want = (over: Partial<ScoutWant> = {}): ScoutWant => ({ wantText: "iphone 15", query: "iphone 15", attributes: [], ...over })

let n = 0
function cand(over: Partial<ScoutCandidate> = {}): ScoutCandidate {
	n++
	return {
		site: "ananas",
		shop: "Ananas",
		title: `iPhone 15 ${n}`,
		price: 40000 + n,
		delivery: null,
		inStock: true,
		url: `https://ananas.rs/p/${n}`,
		image: `https://ananas.rs/i/${n}.jpg`,
		checkedAt: "2026-11-27T10:00:00.000Z",
		...over,
	}
}

function verify(over: Partial<VerifyDeps> = {}): VerifyDeps {
	return {
		reread: async (l) => ({
			site: l.site,
			shop: l.shop,
			title: l.title,
			price: l.price,
			delivery: l.delivery,
			inStock: l.inStock,
			url: l.url,
			image: l.image,
			checkedAt: "2026-11-27T11:00:00.000Z",
		}),
		contentType: async () => "image/jpeg",
		...over,
	}
}

function deps(over: Partial<RunDeps> = {}): RunDeps {
	return { scouts: [], verify: verify(), ...over }
}

function scout(site: ScoutSite, urls: string[], byUrl: Map<string, ScoutCandidate>, over: Partial<ShopScout> = {}): ShopScout {
	return {
		site,
		search: async () => urls,
		read: async (url) => byUrl.get(url) ?? null,
		...over,
	}
}

function mapOf(items: ScoutCandidate[]): Map<string, ScoutCandidate> {
	return new Map(items.map((item) => [item.url, item] as [string, ScoutCandidate]))
}

test("missing scouts are off, clothing skips electronics, and a challenge blocks its site", async () => {
	const clothes = cand()
	const blocked = scout("officeshoes", [clothes.url], mapOf([clothes]), {
		search: async () => {
			throw new ScoutBlocked("Office Shoes blocked the request")
		},
	})
	const tehnomedia = scout("tehnomedia", [], new Map(), {
		search: async () => {
			throw new Error("a skipped site must not search")
		},
	})
	const result = await runScouts(
		want({ query: "zimska jakna" }),
		deps({
			scouts: [tehnomedia, blocked],
			offNotes: { tehnomedia: "not available", gigatron: "robots changed" },
		}),
	)
	assert.equal(result.sites.tehnomedia.status, "skipped")
	assert.equal(result.sites.tehnomedia.note, "not sold here")
	assert.equal(result.sites.gigatron.status, "off")
	assert.equal(result.sites.gigatron.note, "robots changed")
	assert.equal(result.sites.ananas.status, "off")
	assert.equal(result.sites.ananas.note, undefined)
	assert.equal(result.sites.eponuda.status, "off")
	assert.equal(result.sites.cenoteka.status, "off")
	assert.equal(result.sites.officeshoes.status, "blocked")
	assert.equal(result.sites.officeshoes.note, "Office Shoes blocked the request")
	assert.equal(result.best, null)
})

test("a missing scout keeps an off note when one is given", async () => {
	const result = await runScouts(want(), deps({ offNotes: { ananas: "no adapter yet" } }))
	assert.equal(result.sites.ananas.status, "off")
	assert.equal(result.sites.ananas.note, "no adapter yet")
})

test("the time budget stops opening pages and marks the site timeout", async () => {
	let clockMs = 0
	const clock = () => clockMs
	const items = [1, 2, 3, 4, 5].map((i) => cand({ url: `https://ananas.rs/p/${i}`, title: `iPhone 15 ${i}` }))
	const opened: string[] = []
	const adapter = scout("ananas", items.map((c) => c.url), mapOf(items), {
		read: async (url) => {
			opened.push(url)
			clockMs += 125
			return mapOf(items).get(url) ?? null
		},
	})
	const result = await runScouts(want(), deps({ scouts: [adapter], now: clock, budgetMs: 250 }))
	assert.deepEqual(opened, items.slice(0, 2).map((c) => c.url))
	assert.equal(result.sites.ananas.status, "timeout")
	assert.equal(result.sites.ananas.pages, 2)
	assert.equal(result.sites.ananas.found, 2)
})

test("pagesPerSite caps reads without calling it a timeout", async () => {
	const items = [1, 2, 3].map((i) => cand({ url: `https://ananas.rs/p/${i}` }))
	const adapter = scout("ananas", items.map((c) => c.url), mapOf(items))
	const result = await runScouts(want(), deps({ scouts: [adapter], pagesPerSite: 2 }))
	assert.equal(result.sites.ananas.pages, 2)
	assert.equal(result.sites.ananas.status, "ok")
})

test("range, accessory and low-score drops all reach the trace with a why", async () => {
	const pricey = cand({ price: 99999, title: "iPhone 15 128GB" })
	const accessory = cand({ title: "Maska za iPhone 15 128GB" })
	const partial = cand({ title: "Monitor 15 inch" })
	const good = cand({ title: "iPhone 15 128GB" })
	const adapter = scout("ananas", [pricey, accessory, partial, good].map((c) => c.url), mapOf([pricey, accessory, partial, good]))
	const result = await runScouts(want({ query: "iphone 15 128gb", maxPrice: 60000 }), deps({ scouts: [adapter] }))
	assert.equal(result.best?.url, good.url)
	assert.equal(result.trace.length, 4)
	assert.deepEqual(
		result.trace.filter((t) => !t.kept).map((t) => t.drop),
		["out of range", "accessory", "low score"],
	)
	assert.ok(result.trace.every((t) => t.why.length > 0))
	assert.equal(result.trace.at(-1)?.why, "matches: iphone 15 128gb")
})

test("a failed verification drops that listing and promotes the next one", async () => {
	const first = cand({ title: "iPhone 15", price: 40000 })
	const second = cand({ title: "iPhone 15 128GB", price: 41000 })
	const adapter = scout("ananas", [first.url, second.url], mapOf([first, second]))
	const brokenFirst = verify({
		reread: async (l) => ({
			site: l.site,
			shop: l.shop,
			title: l.title,
			price: l.url === first.url ? 39999 : l.price,
			delivery: l.delivery,
			inStock: l.inStock,
			url: l.url,
			image: l.image,
			checkedAt: "2026-11-27T11:00:00.000Z",
		}),
	})
	const result = await runScouts(want(), deps({ scouts: [adapter], verify: brokenFirst }))
	assert.equal(result.best?.url, second.url)
	assert.equal(result.best?.verified, true)
	assert.equal(result.trace.find((t) => t.url === first.url)?.drop, "failed verify")
})

test("slots are never padded", async () => {
	const one = cand()
	const adapter = scout("ananas", [one.url], mapOf([one]))
	const result = await runScouts(want(), deps({ scouts: [adapter] }))
	assert.equal(result.best?.url, one.url)
	assert.deepEqual(result.next, [])
	assert.deepEqual(result.mentions, [])
})

test("a failing read skips the page", async () => {
	const url = "https://ananas.rs/p/broken"
	const adapter = scout("ananas", [url], new Map(), {
		read: async () => {
			throw new Error("no clean price")
		},
	})
	const result = await runScouts(want(), deps({ scouts: [adapter] }))
	assert.equal(result.sites.ananas.status, "ok")
	assert.equal(result.sites.ananas.pages, 1)
	assert.equal(result.sites.ananas.found, 0)
	assert.equal(result.best, null)
})

test("a cache hit returns the stored result without calling a scout again", async () => {
	let searches = 0
	const one = cand()
	const adapter = scout("ananas", [one.url], mapOf([one]), {
		search: async () => {
			searches++
			return [one.url]
		},
	})
	const first = await runScouts(want(), deps({ scouts: [adapter] }))
	assert.equal(searches, 1)
	const second = await runScouts(want({ wantText: "another wording" }), deps({ scouts: [adapter] }))
	assert.deepEqual(second, first)
	assert.equal(searches, 1)
})

test("partial results stream before verification and the final result is finished", async () => {
	const partials: ScoutResult[] = []
	const events: RunEvent[] = []
	const ananas = cand()
	const gigatron = cand({ site: "gigatron", url: "https://gigatron.rs/p/1" })
	const result = await runScouts(
		want(),
		deps({
			scouts: [
				scout("ananas", [ananas.url], mapOf([ananas])),
				scout("gigatron", [gigatron.url], mapOf([gigatron])),
			],
			onPartial: (r) => partials.push(r),
			onEvent: (e) => events.push(e),
		}),
	)
	assert.equal(partials.length, 2)
	assert.ok(partials.every((p) => p.finishedAt === ""))
	assert.ok(partials.every((p) => p.best?.verified === false))
	assert.match(result.finishedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
	assert.ok(events.some((e) => e.site === "query" && e.kind === "start"))
	assert.ok(events.some((e) => e.site === "ananas" && e.kind === "page"))
	assert.ok(events.some((e) => e.site === "verify" && e.kind === "done"))
})


test("budget tiers survive ranking and verification even with ten cheaper matches", async () => {
	const items = [10000, 12000, 15000, 16000, 18000, 20000, 22000, 25000, 28000, 30000, 33333, 33334, 66666, 66667, 100000, 100001]
		.map((price, i) => cand({ title: `iPhone 15 color${i}`, price, delivery: 0 }))
	items.push(cand({ title: "iPhone 15 sold out", price: 80000, inStock: false }))
	items.push(cand({ title: "iPhone 15 delivered", price: 99999, delivery: 2 }))
	const result = await runScouts(want({ maxPrice: 100000 }), deps({ scouts: [scout("ananas", items.map(c => c.url), mapOf(items))], pagesPerSite: 30 }))
	assert.deepEqual(result.budgetTiers?.map(g => g.items.map(l => l.price)), [[10000, 12000, 15000], [33334, 66666], [66667, 100000]])
	assert.ok(result.budgetTiers?.every(g => g.items.every(l => l.verified && l.price + (l.delivery ?? 0) >= g.min && l.price + (l.delivery ?? 0) <= g.max)))
	assert.ok(result.trace.some(t => t.drop === "unavailable"))
})

test("tier verification replaces a failed top choice within the same band", async () => {
	const items = [70000, 80000, 90000, 100000].map((price, i) => cand({ title: `iPhone 15 color${i}`, price }))
	const result = await runScouts(want({ maxPrice: 100000 }), deps({
		scouts: [scout("ananas", items.map(c => c.url), mapOf(items))],
		verify: verify({ reread: async l => l.price === 70000 ? null : l }),
	}))
	assert.deepEqual(result.budgetTiers?.map(g => g.items.map(l => l.price)), [[], [], [80000, 90000, 100000]])
})

test("range-aware search gives each tier page slots and honors the user's minimum", async () => {
	const items = [40000, 50000, 70000, 80000].map(price => cand({ title: `iPhone 15 ${price}`, price }))
	const ranges: unknown[] = []
	const adapter = scout("ananas", [], mapOf(items), {
		supportsPriceRange: true,
		search: async (_query, range) => {
			ranges.push(range)
			return items.filter(c => c.price >= range.minPrice! && c.price <= range.maxPrice!).map(c => c.url)
		},
	})
	const result = await runScouts(want({ minPrice: 35000, maxPrice: 100000 }), deps({ scouts: [adapter], pagesPerSite: 2 }))
	assert.deepEqual(ranges, [{ minPrice: 35000, maxPrice: 66666 }, { minPrice: 66667, maxPrice: 100000 }])
	assert.deepEqual(result.budgetTiers?.map(g => g.items.map(l => l.price)), [[], [40000], [70000]])
})

test("mutating one plan cannot change cached recommendations in another plan", async () => {
	const item = cand()
	const d = deps({ scouts: [scout("ananas", [item.url], mapOf([item]))] })
	const first = await runScouts(want({ maxPrice: 100000 }), d)
	first.best!.price = 1
	first.budgetTiers![1].items.length = 0
	const second = await runScouts(want({ maxPrice: 100000 }), d)
	assert.equal(second.best?.price, item.price)
	assert.equal(second.budgetTiers?.[1].items.length, 1)
})
