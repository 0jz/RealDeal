import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { checkThirtyDay } from "../rules/thirtyDay"
import { generate } from "./generate"
import type { Pattern } from "./types"

// `npm run data [seed]`: writes data/out/dataset.json and prints a summary,
// one example per planted pattern, and a hash to confirm runs are reproducible.

const seed = Number(process.argv[2] ?? 2611)
const data = generate(seed)
const json = JSON.stringify(data, null, 2)

mkdirSync("data/out", { recursive: true })
writeFileSync("data/out/dataset.json", json)

console.log(`seed ${seed}: ${data.shops.length} shops, ${data.skus.length} SKUs, ${data.offers.length} offers, ${data.kp.length} KP listings`)
console.log(`sha256 ${createHash("sha256").update(json).digest("hex").slice(0, 16)}\n`)

const patterns: Pattern[] = ["honest", "presale-hike", "inflated-prev", "new-item", "tiny", "no-sale"]
const fakeExpected = new Set<Pattern>(["presale-hike", "inflated-prev"])
let mismatches = 0

for (const p of patterns) {
	const offers = data.offers.filter((o) => o.pattern === p)
	for (const o of offers) {
		if (checkThirtyDay(o, o.bfPrice).legal === fakeExpected.has(p)) mismatches++
	}
	const ex = offers[0]
	if (!ex) continue
	const r = checkThirtyDay(ex, ex.bfPrice)
	const sku = data.skus.find((s) => s.id === ex.skuId)!.name
	console.log(
		`${p.padEnd(14)} x${String(offers.length).padStart(3)}  e.g. ${ex.shopId} / ${sku}: ` +
			`${ex.bfPrice} RSD, shown prev ${ex.shownPrevPrice} (claims -${r.claimedDiscountPct}%), ` +
			`real ${r.windowDays}d low ${r.realLow} (real ${r.realDiscountPct}% off) → ${r.legal ? "legal" : "VIOLATION"}`,
	)
}

const byShop = data.shops.map((s) => {
	const own = data.offers.filter((o) => o.shopId === s.id)
	const fakes = own.filter((o) => !checkThirtyDay(o, o.bfPrice).legal).length
	return `${s.name} ${fakes}/${own.length}`
})
console.log(`\nviolations per shop: ${byShop.join(", ")}`)
console.log(`KP sealed listings below every shop: ${data.kp.filter((k) => k.condition === "new-sealed" && k.price < Math.min(...data.offers.filter((o) => o.skuId === k.skuId).map((o) => o.bfPrice))).length}`)
console.log(mismatches === 0 ? "rule check: every planted pattern classified as expected" : `rule check: ${mismatches} MISMATCHES`)
process.exitCode = mismatches === 0 ? 0 : 1
