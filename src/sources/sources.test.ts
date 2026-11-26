import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { RawListing } from "../search/types"
import { createFixtureAdapter, normalize } from "./fixture"
import { generate } from "./fixtures/generate"
import { isAllowedByRobots } from "./http"

const fixtureFile = (name: string) => resolve(process.cwd(), "data/fixtures", name)

const kp = createFixtureAdapter({ id: "kp", name: "KupujemProdajem", kind: "classified", file: fixtureFile("kp.json"), latencyMs: [0, 0] })

async function allPages(term: string): Promise<RawListing[]> {
	const out: RawListing[] = []
	for (let page = 1; page < 100; page++) {
		const res = await kp.search(term, page)
		out.push(...res.listings)
		if (!res.hasMore) return out
	}
	return assert.fail("pagination never ended")
}

test("fixture search finds iPhone 15 Pro listings", async () => {
	const hits = await allPages("iphone 15 pro")
	assert.ok(hits.length > 0)
	assert.ok(hits.some((l) => /iphone 15 pro/i.test(l.title)))
	for (const l of hits) {
		const hay = normalize(`${l.title} ${l.description ?? ""}`)
		assert.ok(hay.includes("iphone") && hay.includes("15") && hay.includes("pro"), l.title)
	}
})

test("pagination returns disjoint pages and ends with hasMore=false", async () => {
	const first = await kp.search("iphone", 1)
	const second = await kp.search("iphone", 2)
	assert.equal(first.listings.length, 12)
	assert.equal(first.hasMore, true)
	const firstIds = new Set(first.listings.map((l) => l.id))
	assert.ok(second.listings.every((l) => !firstIds.has(l.id)))

	const all = await allPages("iphone")
	assert.equal(new Set(all.map((l) => l.id)).size, all.length)

	const past = await kp.search("iphone", 1000)
	assert.deepEqual(past, { listings: [], hasMore: false })
})

test("a misspelled-only listing is not found by the literal term", async () => {
	const { kp: listings } = generate()
	const candidate = listings.find((l) => /ajfon/i.test(l.title) && !/iphone/i.test(`${l.title} ${l.description ?? ""}`))
	assert.ok(candidate, "fixtures should contain an ajfon-only listing")

	const byMisspelling = await allPages("ajfon")
	assert.ok(byMisspelling.some((l) => l.id === candidate.id))

	const byLiteralTerm = await allPages("iphone")
	assert.ok(!byLiteralTerm.some((l) => l.id === candidate.id))
})

const KP_ROBOTS = `# snippet in the style of KP's robots.txt
User-agent: *
Disallow: /api/
Disallow: /admin
Allow: /api/public/
`

test("isAllowedByRobots: Disallow prefixes block", () => {
	assert.equal(isAllowedByRobots(KP_ROBOTS, "/api/oglasi?q=iphone"), false)
	assert.equal(isAllowedByRobots(KP_ROBOTS, "/admin"), false)
	assert.equal(isAllowedByRobots(KP_ROBOTS, "/admin/users"), false)
})

test("isAllowedByRobots: longer Allow overrides a broader Disallow", () => {
	assert.equal(isAllowedByRobots(KP_ROBOTS, "/api/public/list"), true)
	assert.equal(isAllowedByRobots(KP_ROBOTS, "/oglasi/iphone-15"), true)
})

test("isAllowedByRobots: empty robots.txt and a group naming us", () => {
	assert.equal(isAllowedByRobots("", "/anything"), true)
	const ourGroup = "User-agent: *\nDisallow: /\n\nUser-agent: RealDealBot\nAllow: /\n"
	assert.equal(isAllowedByRobots(ourGroup, "/oglasi"), true)
	assert.equal(isAllowedByRobots("User-agent: *\nDisallow: /\n", "/oglasi"), false)
})

test("generator is deterministic and yields the planned counts", () => {
	const a = generate()
	assert.deepEqual(a, generate())
	assert.ok(a.kp.length >= 550 && a.kp.length <= 650)
	assert.equal(a.eponuda.length, 250)
	assert.equal(a.cenoteka.length, 80)
	assert.ok(a.eponuda.every((l) => l.history?.length === 60))
})

test("committed fixture files match the generator output", async () => {
	const expected = generate()
	for (const name of ["kp", "eponuda", "cenoteka"] as const) {
		const onDisk = JSON.parse(await readFile(fixtureFile(`${name}.json`), "utf8")) as RawListing[]
		assert.deepEqual(onDisk, expected[name], `run npm run fixtures (${name}.json is stale)`)
	}
})
