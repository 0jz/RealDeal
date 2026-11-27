// One-off live check: runs the real search engine against the live sources
// enabled in LIVE_SOURCES (eponuda, cenoteka, gigatron) and prints what came
// back. Fixtures for the rest. Usage:
//
//   LIVE_SOURCES=eponuda,cenoteka node --import tsx scripts/live-search.ts "iphone 15"

import { search, subscribe } from "../src/search/engine"

const query = process.argv[2] ?? "iphone 15"
const timeoutMs = 90_000

console.log(`Searching for "${query}" (LIVE_SOURCES=${process.env.LIVE_SOURCES ?? "(none)"})…`)
const id = search({ mode: "search", query, origin: "live-check" })

subscribe(id, (view) => {
	if (!view.done) return
	console.log(`\nterms: ${view.terms.join(" | ")}`)
	console.log("sources:")
	for (const s of view.sources) console.log(`  ${s.name.padEnd(16)} ${s.live ? "live" : "fixture"}  ${s.state}  pages=${s.pages} found=${s.found}`)
	console.log(`\n${view.groups.length} product groups, ${view.rejected} rejected`)
	for (const g of view.groups) {
		console.log(`\n${g.name} — low total ${Number.isFinite(g.low) ? g.low : "?"} RSD`)
		for (const r of g.rows.slice(0, 5)) {
			console.log(`  ${r.source}:${r.shopName ?? "?"}  ${r.price} RSD  score ${r.score.toFixed(0)}  ${r.url.slice(0, 70)}`)
		}
	}
	for (const p of view.picks) console.log(`\nPICK: ${p.name} ${p.total} RSD (${p.why})`)
	process.exit(0)
})

setTimeout(() => {
	console.error("timed out waiting for the search to finish")
	process.exit(1)
}, timeoutMs).unref()
