import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdtempSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { commandGoal, createGoal, EXAMPLE_GOAL, getGoal, subscribeGoal } from "./engine"
import type { Command, FinanceView } from "./types"

process.env.REALDEAL_LLM = "0"
process.env.REALDEAL_SESSIONS = mkdtempSync(join(tmpdir(), "realdeal-sessions-"))

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
