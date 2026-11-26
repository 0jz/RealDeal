import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import { commandGoal, createGoal, DEMO_GOAL, getGoal, subscribeGoal } from "./engine"
import type { Command, FinanceView } from "./types"

process.env.REALDEAL_LLM = "0"

export function settled(id: string): Promise<FinanceView> {
	return new Promise((resolve, reject) => {
		let off = () => {}
		const timer = setTimeout(() => { off(); reject(new Error(`Goal ${id} did not settle`)) }, 5000)
		off = subscribeGoal(id, v => { if (!v.pending) { queueMicrotask(off); clearTimeout(timer); resolve(v) } })
	})
}
const act = (v: FinanceView, command: Command) => commandGoal(v.id, { revision: v.revision, requestId: randomUUID(), command })

test("native Mozaik loops overlap, publish intermediate plans and reach the demo outcome", async () => {
	const created = createGoal()
	const intermediate: FinanceView[] = []
	const off = subscribeGoal(created.id, v => intermediate.push(v))
	const v = await settled(created.id); off()
	assert.equal(v.plan.projectedRemaining, 7000)
	assert.ok(intermediate.some(x => x.revision > 0 && x.pending > 0 && (x.offers.length > 0 || x.resale.length > 0)))
	const initial = v.runs.filter(r => ["PurchaseAgent", "ResaleAgent", "ShopTrustAgent"].includes(r.agent))
	assert.equal(initial.length, 3)
	assert.ok(Math.max(...initial.map(r => r.startMs)) < Math.min(...initial.map(r => r.endMs!)), JSON.stringify(initial))
	assert.ok(initial.every(r => r.status === "accepted" && r.finishedAt && r.endMs! > r.startMs))
})
test("live changes reallocate, stale commands fail, receipts are idempotent", async () => {
	let v = await settled(createGoal().id)
	const original = v
	v = await settled(act(v, { type: "resale-drop" }).id)
	assert.equal(v.plan.complete, false); assert.equal(v.plan.expectedCosts, 85000)
	assert.throws(() => act(original, { type: "buy", offerId: "phone-best" }), /Stale revision/)
	v = await settled(act(v, { type: "cheaper-offer" }).id)
	assert.equal(v.plan.complete, true); assert.equal(v.plan.projectedRemaining, 2000)
	const receipt = { revision: v.revision, requestId: randomUUID(), command: { type: "confirm-sale" as const, assetId: "old-phone", gross: 21000 } }
	v = commandGoal(v.id, receipt)
	assert.equal(v.ledger.confirmedResale, 20000)
	assert.equal(commandGoal(v.id, receipt).ledger.confirmedResale, 20000)
	assert.throws(() => commandGoal(v.id, { ...receipt, command: { ...receipt.command, gross: 31000 } }), /reused/)
	v = await settled(v.id)
	v = act(v, { type: "buy", offerId: "phone-best" })
	v = act(v, { type: "buy", offerId: "headphones" })
	assert.equal(v.plan.availableCash, 2000)
	await settled(v.id)
})
test("risk change cancels reservation and blocks purchase", async () => {
	let v = await settled(createGoal({ ...DEMO_GOAL, cash: 100000 }).id)
	v = act(v, { type: "reserve", offerId: "phone-best" })
	assert.equal(v.plan.reservedCash, 85000)
	v = act(v, { type: "trust-drop" })
	assert.equal(v.plan.reservedCash, 0)
	assert.throws(() => act(v, { type: "buy", offerId: "phone-best" }), /unsafe/)
	await settled(v.id)
})
test("interception rejects actual in-flight obsolete responses without changing submitted requests", { timeout: 5000 }, async () => {
	const baseline = await settled(createGoal().id)
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
		const changed = act(getGoal(initial.id)!, { type: "resale-drop" })
		assert.ok(changed.pending >= 4)
		assert.equal(changed.plan.expectedCosts, 85000, "plan changed while four old requests were still in flight")
		assert.equal(changed.plan.complete, false)
		for (const release of releases) release()
		const v = await settled(initial.id)
		assert.equal(v.resale[0].net, 20000)
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
		const v = await settled(createGoal().id)
		assert.equal(v.plan.projectedRemaining, 7000)
		assert.ok(v.runs.some(r => r.status === "error"))
		assert.throws(() => act(v, { type: "buy", offerId: "phone-best" }), /Insufficient/)
	} finally { globalThis.fetch = originalFetch; process.env.REALDEAL_LLM = "0"; if (oldKey == null) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey }
})
