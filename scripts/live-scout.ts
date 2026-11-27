// Live planner check. No fixtures, no injected shops. Example:
// REALDEAL_LLM=0 node --import tsx scripts/live-scout.ts "Phone for 100000 RSD"
// Optional second argument: output JSON path (default data/out/live-scout.json).

import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { createGoalFromPrompt, subscribeGoal } from "../src/finance/engine"
import type { FinanceView } from "../src/finance/types"
import { SCOUT_BUDGET_MS } from "../src/scout/run"
import { judgeOffline } from "../src/scout/judge"
import { total } from "../src/scout/rank"
import type { ScoutListing } from "../src/scout/types"

const prompt = process.argv[2] ?? "Phone for 100000 RSD"
const output = resolve(process.argv[3] ?? "data/out/live-scout.json")
const startedAt = new Date().toISOString()
console.log(`Planning "${prompt}" against live shops…`)
const created = await createGoalFromPrompt({ prompt })

const view = await new Promise<FinanceView>((resolve, reject) => {
	let off = () => {}
	let last = ""
	const timer = setTimeout(() => { off(); reject(new Error("Live scouts did not finish in time")) }, SCOUT_BUDGET_MS + 120_000)
	off = subscribeGoal(created.id, v => {
		const state = Object.entries(v.scouts ?? {}).map(([id, r]) => `${id}: ${Object.entries(r.sites).map(([site, s]) => `${site}=${s.status}/${s.found}`).join(" ")}`).join("\n")
		if (state && state !== last) { console.log(state); last = state }
		const ids = Object.keys(v.scoutWants ?? {})
		if (ids.length && !v.pending && ids.every(id => !!v.scouts?.[id]?.finishedAt)) {
			clearTimeout(timer); queueMicrotask(off); resolve(v)
		}
	})
})

const checks: { wish: string; check: string; passed: boolean }[] = []
const listingOk = (listing: ScoutListing) => listing.verified && listing.inStock !== false
	&& listing.url.startsWith("https://") && !/\/fixture\/|\/stub\//.test(listing.url)
for (const [id, result] of Object.entries(view.scouts ?? {})) {
	console.log(`\n${id}: ${result.query}`)
	if (result.maxPrice !== undefined) {
		const tiers = result.budgetTiers ?? []
		checks.push({ wish: id, check: "three populated price tiers", passed: tiers.length === 3 && tiers.every(t => t.items.length > 0) })
		for (const tier of tiers) {
			console.log(`  ${tier.tier}: ${tier.min}–${tier.max} RSD (${tier.items.length} listings)`)
			for (const item of tier.items) console.log(`    ${item.title} | ${total(item)} RSD | ${item.shop} | ${item.url}${item.delivery === null ? " | delivery unknown" : ""}`)
			checks.push({ wish: id, check: `${tier.tier}: verified, in stock or unknown, inside range`, passed: tier.items.every(l => listingOk(l) && !judgeOffline(view.scoutWants![id], l).drop && total(l) >= tier.min && total(l) <= tier.max) })
		}
	} else {
		checks.push({ wish: id, check: "a verified listing", passed: !!result.best && listingOk(result.best) })
	}
}
await mkdir(dirname(output), { recursive: true })
await writeFile(output, JSON.stringify({ prompt, startedAt, finishedAt: new Date().toISOString(), planId: view.id, checks, scouts: view.scouts }, null, 2) + "\n")
for (const c of checks) console.log(`${c.passed ? "PASS" : "FAIL"} ${c.wish}: ${c.check}`)
console.log(`Evidence: ${output}`)
process.exit(checks.length > 0 && checks.every(c => c.passed) ? 0 : 1)
