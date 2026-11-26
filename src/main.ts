import "dotenv/config"
import { kpMarketAgent } from "./agents/kpMarket"
import { priceFeed, runFeed } from "./agents/priceFeed"
import { thirtyDayAgent } from "./agents/thirtyDay"
import { delay } from "./agents/kit"
import { generate } from "./data/generate"
import { initializeRuntime, join, MarketState } from "./runtime"

const runtime = initializeRuntime({ state: new MarketState(generate(2611)) })

join(priceFeed)
join(thirtyDayAgent)
join(kpMarketAgent)

await runFeed({ count: 12, intervalMs: 80 })
await delay(800) // let in-flight handlers finish

const { log } = runtime.state
for (const e of log) {
	console.log(`${String(e.t).padStart(5)}ms  ${e.agent.padEnd(15)} ${e.kind.padEnd(5)} ${e.event}${e.detail ? `  ${e.detail}` : ""}`)
}

// Concurrency check: how many handlers were in flight at once.
let inFlight = 0
let peak = 0
for (const e of log) {
	if (e.kind === "start") peak = Math.max(peak, ++inFlight)
	if (e.kind === "end" || e.kind === "error") inFlight--
}
const errors = log.filter((e) => e.kind === "error").length
console.log(`\n${log.length} log entries, peak ${peak} handlers in flight at once, ${errors} errors`)
