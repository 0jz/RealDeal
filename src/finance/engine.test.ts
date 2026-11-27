import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { commandGoal, createGoal, createGoalFromPrompt, EXAMPLE_GOAL, getGoal, PromptError, setScoutShops, subscribeGoal } from "./engine"
import { stubShops } from "../scout/stub"
import type { Command, FinanceView } from "./types"

process.env.REALDEAL_LLM = "0"
process.env.REALDEAL_SESSIONS = mkdtempSync(join(tmpdir(), "realdeal-sessions-"))
setScoutShops(stubShops(84_999))

/** Settled and every scouting run finished. */
export function scouted(id: string): Promise<FinanceView> {
	return new Promise((resolve, reject) => {
		let off = () => {}
		const timer = setTimeout(() => { off(); reject(new Error(`Goal ${id} did not finish scouting`)) }, 5000)
		const done = (v: FinanceView) => !v.pending && Object.keys(v.scoutWants ?? {}).every(w => (v.scouts?.[w]?.finishedAt ?? "") !== "")
		off = subscribeGoal(id, v => { if (done(v)) { queueMicrotask(off); clearTimeout(timer); resolve(v) } })
	})
}

export function settled(id: string): Promise<FinanceView> {
	return new Promise((resolve, reject) => {
		let off = () => {}
		const timer = setTimeout(() => { off(); reject(new Error(`Goal ${id} did not settle`)) }, 5000)
		off = subscribeGoal(id, v => { if (!v.pending) { queueMicrotask(off); clearTimeout(timer); resolve(v) } })
	})
}
const act = (v: FinanceView, command: Command) => commandGoal(v.id, { revision: v.revision, requestId: randomUUID(), command })

test("native Mozaik loops publish intermediate plans and reach the expected outcome", async () => {
	const created = createGoal(EXAMPLE_GOAL)
	assert.ok(Number.isFinite(created.nowMs), "snapshot has a finite server clock")
	const intermediate: FinanceView[] = []
	const off = subscribeGoal(created.id, v => intermediate.push(v))
	const v = await settled(created.id); off()
	assert.equal(v.plan.projectedRemaining, 3600)
	assert.ok(intermediate.some(x => x.revision > 0 && x.pending > 0 && (x.offers.length > 0 || x.resale.length > 0)))
	const initial = v.runs.filter(r => ["PurchaseAgent", "ResaleAgent", "ShopTrustAgent"].includes(r.agent))
	assert.equal(initial.length, 3)
	assert.ok(initial.every(r => r.status === "accepted" && r.finishedAt && r.endMs! >= r.startMs))
})
test("goal updates re-plan, stale commands fail, receipts are idempotent", async () => {
	let v = await settled(createGoal(EXAMPLE_GOAL).id)
	const original = v
	const lower = { ...v.goal, assets: v.goal.assets.map(a => ({ ...a, expectedPrice: 30000 })) }
	v = await settled(act(v, { type: "update-goal", goal: lower }).id)
	assert.equal(v.plan.complete, false); assert.equal(v.plan.expectedCosts, 85000)
	assert.throws(() => act(original, { type: "buy", offerId: "phone" }), /changed in the meantime/)
	v = await settled(act(v, { type: "update-goal", goal: { ...lower, wishes: lower.wishes.map(w => w.id === "phone" ? { ...w, price: 75000 } : w) } }).id)
	assert.equal(v.plan.complete, true); assert.equal(v.plan.projectedRemaining, 3600)
	const receipt = { revision: v.revision, requestId: randomUUID(), command: { type: "confirm-sale" as const, assetId: "old-phone", gross: 30000 } }
	v = commandGoal(v.id, receipt)
	assert.equal(v.ledger.confirmedResale, 29000)
	assert.equal(commandGoal(v.id, receipt).ledger.confirmedResale, 29000)
	assert.throws(() => commandGoal(v.id, { ...receipt, command: { ...receipt.command, gross: 31000 } }), /reused/)
	v = await settled(v.id)
	v = act(v, { type: "buy", offerId: "phone" })
	v = act(v, { type: "buy", offerId: "audio" })
	assert.equal(v.plan.availableCash, 3600)
	await settled(v.id)
})
test("an update that makes an offer risky releases its set-aside money and blocks buying", async () => {
	let v = await settled(createGoal({ ...EXAMPLE_GOAL, cash: 120000 }).id)
	v = act(v, { type: "reserve", offerId: "phone" })
	assert.equal(v.plan.reservedCash, 85000)
	v = await settled(act(v, { type: "update-goal", goal: { ...v.goal, wishes: v.goal.wishes.map(w => w.id === "phone" ? { ...w, delivery: null } : w) } }).id)
	assert.equal(v.plan.reservedCash, 0)
	assert.throws(() => act(v, { type: "buy", offerId: "phone" }), /blocked/)
})
test("lowering cash below what was spent is rejected", async () => {
	let v = await settled(createGoal({ ...EXAMPLE_GOAL, cash: 120000 }).id)
	v = act(v, { type: "buy", offerId: "phone" })
	assert.throws(() => act(v, { type: "update-goal", goal: { ...v.goal, cash: 50000 } }), /already spent/)
	await settled(v.id)
})
test("plans are saved to disk and bad IDs are rejected", async () => {
	const v = await settled(createGoal(EXAMPLE_GOAL).id)
	assert.ok(readdirSync(process.env.REALDEAL_SESSIONS!).includes(`${v.id}.json`))
	assert.equal(getGoal("00000000-0000-0000-0000-000000000000"), null)
	assert.equal(getGoal("../../etc/passwd"), null)
})
test("a prompt becomes a stored plan with its intent, and update-goal keeps the intent", async () => {
	const created = await createGoalFromPrompt({ prompt: "Hoću iPhone 15 za 85k, prodajem stari ajfon 13", budget: 100000 })
	// Before the scouts report, the wish has no price and stays out of the budget.
	assert.equal(created.goal.wishes[0].priceSource, "listing")
	assert.equal(created.plan.expectedCosts, 0)
	const v = await scouted(created.id)
	const wish = v.goal.wishes[0]
	assert.match(wish.name, /iPhone 15/i)
	assert.equal(wish.price, 84999)
	assert.equal(wish.priceSource, "listing")
	assert.equal(wish.link, v.scouts?.[wish.id]?.best?.url)
	assert.equal(v.scouts?.[wish.id]?.best?.verified, true)
	assert.ok(v.runs.some(r => r.agent === "AnanasScout" && r.status === "accepted"))
	assert.ok(v.intent)
	assert.ok(JSON.parse(readFileSync(join(process.env.REALDEAL_SESSIONS!, `${v.id}.json`), "utf8")).intent)
	const updated = await settled(act(v, { type: "update-goal", goal: { ...v.goal, cash: 110000 } }).id)
	assert.deepEqual(updated.intent, v.intent)
	assert.deepEqual(getGoal(v.id)?.intent, v.intent)
})
test("every agent run records when it was queued, before it started", async () => {
	const v = await settled((await createGoalFromPrompt({ prompt: "Hoću iPhone 15 za 85k", budget: 100000 })).id)
	assert.ok(v.runs.length > 0)
	for (const r of v.runs) {
		assert.equal(typeof r.queuedMs, "number")
		assert.ok(r.queuedMs! <= r.startMs)
	}
})
test("a prompt with nothing to buy is rejected with the unknown text", async () => {
	await assert.rejects(createGoalFromPrompt({ prompt: "asdf qwerty", budget: 50000 }), (e: unknown) => e instanceof PromptError && e.unknown.length > 0)
})
test("a prompt without an amount asks how much can be spent", async () => {
	await assert.rejects(createGoalFromPrompt({ prompt: "new phone" }), (e: unknown) => e instanceof PromptError && /How much can you spend/.test(e.message))
})
test("an over-long prompt is rejected before parsing", async () => {
	await assert.rejects(createGoalFromPrompt({ prompt: "a".repeat(1001), budget: 50000 }), /1 to 1000 characters/)
})
test("interception rejects actual in-flight obsolete responses without changing submitted requests", { timeout: 5000 }, async () => {
	const baseline = await settled(createGoal(EXAMPLE_GOAL).id)
	const originalFetch = globalThis.fetch
	const oldKey = process.env.OPENAI_API_KEY
	process.env.REALDEAL_LLM = "1"; process.env.OPENAI_API_KEY = "offline-test-key"
	const releases: (() => void)[] = []
	let reportStarted: () => void
	const allStarted = new Promise<void>(resolve => { reportStarted = resolve })
	let requests = 0
	globalThis.fetch = (async () => {
		requests++
		if (requests <= 4) {
			await new Promise<void>(resolve => { releases.push(resolve); if (releases.length === 4) reportStarted() })
			return Response.json({ choices: [{ message: { content: "OBSOLETE explanation" } }] })
		}
		return Response.json({ choices: [{ message: { content: "Current explanation from mocked provider" } }] })
	}) as typeof fetch
	try {
		const initial = act(baseline, { type: "refresh" })
		await allStarted
		const lower = { ...initial.goal, assets: initial.goal.assets.map(a => ({ ...a, expectedPrice: 30000 })) }
		const changed = act(getGoal(initial.id)!, { type: "update-goal", goal: lower })
		assert.ok(changed.pending >= 4)
		for (const release of releases) release()
		const v = await settled(initial.id)
		assert.equal(v.resale[0].net, 29000)
		assert.equal(v.plan.complete, false)
		assert.ok(v.runs.filter(r => r.status === "stale").length >= 4)
		assert.ok(v.runs.some(r => r.detail?.includes("intercepted the next transition")))
		assert.ok(Object.values(v.notes).every(n => !n.includes("OBSOLETE")))
	} finally { globalThis.fetch = originalFetch; process.env.REALDEAL_LLM = "0"; if (oldKey == null) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey }
})
test("provider failure settles and preserves deterministic safety", async () => {
	const originalFetch = globalThis.fetch
	const oldKey = process.env.OPENAI_API_KEY
	process.env.REALDEAL_LLM = "1"; process.env.OPENAI_API_KEY = "offline-test-key"
	globalThis.fetch = (async () => { throw new Error("provider unavailable") }) as typeof fetch
	try {
		const v = await settled(createGoal(EXAMPLE_GOAL).id)
		assert.equal(v.plan.projectedRemaining, 3600)
		assert.ok(v.runs.some(r => r.status === "error"))
		assert.throws(() => act(v, { type: "buy", offerId: "phone" }), /Not enough cash/)
	} finally { globalThis.fetch = originalFetch; process.env.REALDEAL_LLM = "0"; if (oldKey == null) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey }
})
