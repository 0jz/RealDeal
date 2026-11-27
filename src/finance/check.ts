import "dotenv/config"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { commandGoal, createGoal, createGoalFromPrompt, EXAMPLE_GOAL, setScoutShops, subscribeGoal } from "./engine"
import { stubShops } from "../scout/stub"
import type { Command, FinanceView } from "./types"

process.env.REALDEAL_SESSIONS = await mkdtemp(join(tmpdir(), "realdeal-check-"))
// Offline: stand-in shops, so the check never touches the network.
setScoutShops(stubShops(39_999))
const wait = (id: string) => new Promise<FinanceView>((resolve, reject) => {
	let off = () => {}
	const timer = setTimeout(() => { off(); reject(new Error("Analysis exceeded 45 seconds")) }, 45000)
	const done = (v: FinanceView) => !v.pending && Object.keys(v.scoutWants ?? {}).every(w => (v.scouts?.[w]?.finishedAt ?? "") !== "")
	off = subscribeGoal(id, v => { if (done(v)) { queueMicrotask(off); clearTimeout(timer); resolve(v) } })
})
const command = (v: FinanceView, command: Command) => commandGoal(v.id, { revision: v.revision, requestId: randomUUID(), command })
let v = await wait(createGoal(EXAMPLE_GOAL).id)
assert.equal(v.plan.expectedCosts, 110400)
assert.equal(v.plan.projectedRemaining, 3600)
assert.equal(v.runs.filter(r => r.status === "accepted").length >= 4, true)
console.log("PASS example plan: 75,000 cash + 39,000 expected sale − 110,400 purchases = 3,600 left")
assert.throws(() => command(v, { type: "buy", offerId: "phone" }), /Not enough cash/)
console.log("PASS money from a sale that hasn't happened can't be spent")
const lower = { ...v.goal, assets: v.goal.assets.map(a => ({ ...a, expectedPrice: 30000 })) }
v = await wait(command(v, { type: "update-goal", goal: lower }).id)
assert.equal(v.plan.complete, false)
console.log("PASS lower sale price defers the earbuds instead of overspending")
v = await wait(command(v, { type: "update-goal", goal: { ...lower, wishes: lower.wishes.map(w => w.id === "phone" ? { ...w, price: 75000 } : w) } }).id)
assert.equal(v.plan.complete, true)
console.log("PASS cheaper phone offer restores both purchases")
v = await wait(command(v, { type: "confirm-sale", assetId: "old-phone", gross: 30000 }).id)
v = command(v, { type: "buy", offerId: "phone" })
v = command(v, { type: "buy", offerId: "audio" })
v = await wait(v.id)
assert.equal(v.plan.availableCash, 3600)
console.log("PASS recorded sale and purchases leave 3,600 RSD")
const prompt = "New phone for 75000 RSD. I can sell my iPhone 13, it's in good shape."
let p = await wait((await createGoalFromPrompt({ prompt })).id)
const phone = p.goal.wishes[0]
assert.equal(p.goal.cash, 75000)
assert.equal(phone.priceSource, "listing")
assert.equal(phone.price, 39999)
assert.ok(phone.link.startsWith("https://") && p.plan.complete && p.plan.projectedRemaining >= 0)
assert.ok(p.intent && p.scouts?.[phone.id]?.best?.verified)
console.log(`PASS prompt "${prompt}" → ${phone.name} at ${phone.shop}, exact listing price ${phone.price.toLocaleString("sr-RS")} RSD, ${p.plan.projectedRemaining.toLocaleString("sr-RS")} RSD left`)
p = command(p, { type: "buy", offerId: phone.id })
assert.equal(p.ledger.spent, 39999)
console.log("PASS buying at a listing price records that exact price")
await wait(p.id)
await mkdir("data/out", { recursive: true })
await writeFile("data/out/finance-evidence.json", JSON.stringify({ view: v }, null, 2))
console.log("Saved timestamps, revisions and outcomes to data/out/finance-evidence.json")
