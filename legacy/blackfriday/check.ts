import "dotenv/config"
import { EV } from "./agents/events"
import { delay } from "./agents/kit"
import { emitPrice, feedQueue } from "./agents/priceFeed"
import { TRUST_THRESHOLD } from "./rules/verdict"
import { observeVerdicts, startSwarm } from "./swarm"
import type { VerdictUpdated } from "./agents/events"

// `npm run check` runs the swarm headless, prints a summary and self-checks;
// `npm run check -- --log` also prints every event.

const state = startSwarm(2611)
const updates: VerdictUpdated[] = []
observeVerdicts((u) => updates.push(u), state)

for (const o of feedQueue()) {
	emitPrice(o)
	await delay(20)
}
await delay(1000) // let in-flight handlers finish

const { log, verdicts, trust, data } = state

if (process.argv.includes("--log")) {
	for (const e of log) {
		console.log(`${String(e.t).padStart(5)}ms  ${e.agent.padEnd(15)} ${e.kind.padEnd(5)} ${e.event}${e.detail ? `  ${e.detail}` : ""}`)
	}
	console.log()
}

// Concurrency: how many handlers were in flight at once.
let inFlight = 0
let peak = 0
for (const e of log) {
	if (e.kind === "start") peak = Math.max(peak, ++inFlight)
	if (e.kind === "end" || e.kind === "error") inFlight--
}

const count = (pred: (e: (typeof log)[number]) => boolean) => log.filter(pred).length
const cascades = log.filter((e) => e.kind === "end" && e.event === EV.shopTrustChanged && !/ 0 flipped/.test(e.detail ?? ""))
const finals = [...verdicts.values()]
const onHold = updates.filter((u) => u.cause === EV.shopTrustChanged && u.previous === "REAL DEAL" && u.verdict === "WAIT")
const byVerdict = Object.entries(Object.groupBy(finals, (v) => v.verdict)).map(([k, v]) => `${k} ${v!.length}`)

console.log(`events emitted: ${count((e) => e.kind === "emit")}, peak ${peak} handlers in flight, errors ${count((e) => e.kind === "error")}`)
console.log(`verdict flips: ${count((e) => e.kind === "emit" && e.event === EV.verdictUpdated)}`)
console.log(`final verdicts: ${byVerdict.join(", ")}`)
console.log(`trust: ${data.shops.map((s) => `${s.name} ${trust.get(s.id)}`).join(", ")}`)
console.log(`REAL DEAL put on hold by a cascade: ${onHold.length} (${[...new Set(onHold.map((u) => u.shopId))].join(", ")})`)
console.log(`cascades that flipped verdicts: ${cascades.length}${cascades[0] ? `, e.g. "${cascades[0].detail}"` : ""}`)

const fakePlanted = finals.filter((v) => {
	const o = data.offers.find((o) => o.shopId === v.shopId && o.skuId === v.skuId)!
	return o.pattern === "presale-hike" || o.pattern === "inflated-prev"
})
const checks: Array<[string, boolean]> = [
	["no handler errors", count((e) => e.kind === "error") === 0],
	["handlers overlapped (peak > 1)", peak > 1],
	["no offer left CHECKING", finals.every((v) => v.verdict !== "CHECKING")],
	["every planted fake ends FAKE DISCOUNT", fakePlanted.every((v) => v.verdict === "FAKE DISCOUNT")],
	["a trust drop flipped other verdicts", cascades.length > 0],
	["a caught shop's REAL DEAL was put on hold by the cascade", onHold.length > 0],
	["at most one shop ends under the trust threshold", data.shops.filter((s) => trust.get(s.id)! < TRUST_THRESHOLD).length <= 1],
	["at least one BUY ON KP INSTEAD", finals.some((v) => v.verdict === "BUY ON KP INSTEAD")],
	["at least one REAL DEAL", finals.some((v) => v.verdict === "REAL DEAL")],
]
console.log()
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`)
process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1
