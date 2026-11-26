import "dotenv/config"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { commandGoal, createGoal, subscribeGoal } from "./engine"
import type { Command, FinanceView } from "./types"

const wait = (id: string) => new Promise<FinanceView>((resolve, reject) => {
	let off = () => {}
	const timer = setTimeout(() => { off(); reject(new Error("Analysis exceeded 45 seconds")) }, 45000)
	off = subscribeGoal(id, v => { if (!v.pending) { queueMicrotask(off); clearTimeout(timer); resolve(v) } })
})
const command = (v: FinanceView, command: Command) => commandGoal(v.id, { revision: v.revision, requestId: randomUUID(), command })
let v = await wait(createGoal().id)
assert.equal(v.plan.expectedCosts, 93000)
assert.equal(v.plan.projectedRemaining, 7000)
const runs = v.runs.filter(r => ["PurchaseAgent", "ResaleAgent", "ShopTrustAgent"].includes(r.agent))
const overlapMs = Math.min(...runs.map(r => r.endMs!)) - Math.max(...runs.map(r => r.startMs))
assert.ok(overlapMs > 0)
console.log(`PASS native Mozaik overlap across three independent workloads: ${overlapMs.toFixed(3)} ms`)
console.log(`PASS demo plan: 70,000 cash + 30,000 estimated resale − 93,000 purchases = 7,000 projected`)
assert.throws(() => command(v, { type: "buy", offerId: "phone-best" }), /Insufficient/)
console.log("PASS unconfirmed proceeds cannot fund a purchase")
v = await wait(command(v, { type: "resale-drop" }).id)
assert.equal(v.plan.complete, false)
console.log("PASS resale reduction defers headphones instead of overspending")
v = await wait(command(v, { type: "cheaper-offer" }).id)
assert.equal(v.plan.complete, true)
console.log("PASS cheaper phone restores both purchases")
v = await wait(command(v, { type: "confirm-sale", assetId: "old-phone", gross: 21000 }).id)
v = command(v, { type: "buy", offerId: "phone-best" })
v = command(v, { type: "buy", offerId: "headphones" })
v = await wait(v.id)
assert.equal(v.plan.availableCash, 2000)
console.log("PASS net confirmed sale and simulated purchases leave 2,000 RSD cash")
await mkdir("data/out", { recursive: true })
await writeFile("data/out/finance-evidence.json", JSON.stringify({ overlapMs, view: v }, null, 2))
console.log("Saved actual timestamps, revisions and outcomes to data/out/finance-evidence.json")
