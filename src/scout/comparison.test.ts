import assert from "node:assert/strict"
import { test } from "node:test"
import { comparisonReader } from "./comparison"
import { createEponudaScout } from "./eponuda"
import { runScouts, clearScoutCache } from "./run"
import { shopDeps } from "./shops"
import { ScoutBlocked } from "./types"

test("comparison readers preserve blocked and failed access instead of reporting an empty shop", async () => {
	await assert.rejects(comparisonReader(async () => null, () => true)("https://www.eponuda.com/x"), ScoutBlocked)
	await assert.rejects(comparisonReader(async () => null, () => false)("https://cenoteka.rs/x"), /Could not read/)
	let fresh: boolean | undefined
	const read = comparisonReader(async (_url, options) => { fresh = options?.fresh; return "<html>products</html>" })
	assert.equal(await read("https://cenoteka.rs/x", { fresh: true }), "<html>products</html>")
	assert.equal(fresh, true)
})

test("a challenged comparison source is blocked in the actual scouting result", async () => {
	clearScoutCache()
	const scout = createEponudaScout(comparisonReader(async () => null, () => true))
	const result = await runScouts({ wantText: "phone", query: "telefon", attributes: [], maxPrice: 100000 }, {
		scouts: [scout], verify: { reread: async () => null, contentType: async () => null },
	})
	assert.equal(result.sites.eponuda.status, "blocked")
	assert.match(result.sites.eponuda.note ?? "", /blocked/)
	assert.deepEqual(result.budgetTiers?.map(t => t.items), [[], [], []])
})

test("the planner includes Tehnomedia as an independent direct shop", () => {
	const deps = shopDeps()
	assert.ok(deps.scouts.some(s => s.site === "tehnomedia"))
	assert.equal(deps.offNotes.tehnomedia, undefined)
})
