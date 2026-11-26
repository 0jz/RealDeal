import "dotenv/config"
import { EV } from "./search/events"
import { getView, search, startEngine, subscribe } from "./search/engine"
import type { SearchRequest, SearchView } from "./search/types"

// `npm run check` runs three searches at once on the fixture sources, prints a
// summary and self-checks; `npm run check -- --log` also prints every event.

const state = startEngine()

const requests: SearchRequest[] = [
	{ mode: "search", query: "ajfon 15 pro", origin: "check" },
	{ mode: "budget", query: "telefon", category: "phone", budget: 100_000, origin: "check" },
	{ mode: "sell", query: "iPhone 13 128GB polovan, baterija 86%", origin: "check" },
]

/** When each search showed its first result, and when its last source finished. */
const firstResultAt = new Map<string, number>()
const ids = requests.map((r) => search(r))
await Promise.all(
	ids.map(
		(id) =>
			new Promise<void>((resolve) => {
				const off = subscribe(id, (v) => {
					if (v.groups.length && !firstResultAt.has(id)) firstResultAt.set(id, Date.now())
					if (v.done) {
						off()
						resolve()
					}
				})
			}),
	),
)
await new Promise((r) => setTimeout(r, 300)) // let the last handlers settle

const { log } = state
if (process.argv.includes("--log")) {
	for (const e of log) console.log(`${String(e.t).padStart(5)}ms  ${(e.searchId ?? "").padEnd(8)} ${e.agent.padEnd(16)} ${e.kind.padEnd(5)} ${e.event}${e.detail ? `  ${e.detail}` : ""}`)
	console.log()
}

// Concurrency: handlers in flight at once, and which agents overlapped.
let inFlight = 0
let peak = 0
const running = new Map<number, string>()
const overlapped = new Set<string>()
for (const e of log) {
	if (e.kind === "start" && e.run != null) {
		for (const a of running.values()) if (a !== e.agent) overlapped.add([a, e.agent].sort().join(" + "))
		running.set(e.run, e.agent)
		peak = Math.max(peak, ++inFlight)
	}
	if ((e.kind === "end" || e.kind === "error") && e.run != null) {
		running.delete(e.run)
		inFlight--
	}
}
const errors = log.filter((e) => e.kind === "error")
const sourceDoneAt = (id: string) => Math.max(...log.filter((e) => e.searchId === id && e.kind === "emit" && e.event === EV.sourceDone).map((e) => e.t))

const views = ids.map((id) => getView(id)!) as SearchView[]
const [found, budget, sell] = views
const rows = (v: SearchView) => v.groups.flatMap((g) => g.rows)

for (const v of views) {
	console.log(`\n[${v.request.mode}] "${v.request.query}"${v.request.budget ? ` budget ${v.request.budget}` : ""}`)
	console.log(`  terms: ${v.terms.join(" | ")}`)
	console.log(`  sources: ${v.sources.map((s) => `${s.id} ${s.pages}p/${s.found}`).join(", ")}; ${rows(v).length} matched, ${v.rejected} rejected`)
	for (const g of v.groups.slice(0, 4)) console.log(`  ${g.name}: ${g.rows.length} listings from ${g.low}, e.g. "${g.rows[0].title}" (${g.rows[0].method})`)
	for (const p of v.picks) console.log(`  PICK ${p.name} ${p.total} (ostaje ${p.leftover}) — ${p.why}`)
	if (v.sell) console.log(`  SELL ${v.sell.name}: ${v.sell.quick}–${v.sell.patient} from ${v.sell.comps.length} comps; draft "${v.sell.draft?.title}"`)
}

const earlyStart = ids.every((id) => (firstResultAt.get(id) ?? Infinity) - state.startedAt < sourceDoneAt(id))
console.log(`\nevents emitted: ${log.filter((e) => e.kind === "emit").length}, peak ${peak} handlers in flight, errors ${errors.length}`)
console.log(`agents that ran at the same moment: ${[...overlapped].filter((p) => /Source/.test(p)).slice(0, 6).join(", ")}…`)

const checks: Array<[string, boolean]> = [
	["no handler errors", errors.length === 0],
	["handlers overlapped (peak > 1)", peak > 1],
	["sources paged concurrently with each other", [...overlapped].some((p) => /Source:\w+ \+ Source:\w+/.test(p))],
	["matcher ran while sources were still paging", [...overlapped].some((p) => /MatcherAgent/.test(p) && /Source:/.test(p))],
	["first results showed before the last source finished", earlyStart],
	["misspelled listings found (titles without the literal query)", rows(found).some((r) => !/iphone/i.test(r.title))],
	["search for 15 Pro returns only iPhone 15 Pro", found.groups.every((g) => g.productId === "iphone-15-pro") && found.groups.length === 1],
	["look-alikes rejected", found.rejected > 0],
	["budget picks exist and every pick ≤ budget", budget.picks.length > 0 && budget.picks.every((p) => p.total <= 100_000)],
	["sell estimate with a price range", !!sell.sell?.quick && !!sell.sell?.patient && sell.sell.quick <= sell.sell.patient],
	["every search finished", views.every((v) => v.done)],
]
console.log()
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`)
process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1
process.exit()
