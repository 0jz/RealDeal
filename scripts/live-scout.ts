// One-off live check of the planner's scout layer (Ananas + eponuda + Cenoteka,
// real sites, customer profile from src/sources/customer.ts). Usage:
//
//   node --import tsx scripts/live-scout.ts "iPhone 15 za 90000"

import { createGoalFromPrompt, subscribeGoal } from "../src/finance/engine"

const prompt = process.argv[2] ?? "iPhone 15 za 90000"

console.log(`Planning "${prompt}" with LIVE scouts…`)
const view = await createGoalFromPrompt({ prompt })
console.log(`plan ${view.id} created; waiting for the scouts`)

let last = 0
subscribeGoal(view.id, (v) => {
	const pending = v.runs.filter((r) => r.status === "running").length
	if (pending > 0 || Date.now() - last < 4000) return
	last = Date.now()
	for (const [wishId, result] of Object.entries(v.scouts ?? {})) {
		if (!result.finishedAt) {
			console.log(`  ${wishId}: scouting… ${Object.entries(result.sites).map(([s, r]) => `${s}:${r.status}(${r.found})`).join(" ")}`)
			continue
		}
		console.log(`  ${wishId}: done — best: ${result.best ? `${result.best.title} @ ${result.best.shop} = ${result.best.price} RSD (verified: ${result.best.verified})` : "no listing"}`)
		for (const [site, report] of Object.entries(result.sites)) console.log(`      ${site}: ${report.status} pages=${report.pages} found=${report.found}${report.note ? ` (${report.note})` : ""}`)
	}
	if (!pending && Object.values(v.scouts ?? {}).every((r) => r.finishedAt)) {
		const wish = v.goal.wishes.find((w) => w.priceSource === "listing") ?? v.goal.wishes[0]
		console.log(`\nwish after scouts: ${wish?.name} — ${wish?.price ?? 0} RSD at ${wish?.shop || "?"}`)
		console.log(`plan: ${v.plan.steps.map((s: never) => "").join("")}${v.plan.conditional ? "conditional (sell first)" : "pay from cash"}`)
		process.exit(0)
	}
})

setTimeout(() => {
	console.error("timed out waiting for the scouts")
	process.exit(1)
}, 240_000).unref()
