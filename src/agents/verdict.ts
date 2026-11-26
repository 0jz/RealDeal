import { emit, offerKey, resolveRuntime } from "../runtime"
import { decide } from "../rules/verdict"
import {
	EV,
	type CrossShopBest,
	type DiscountChecked,
	type KpPrice,
	type PriceChanged,
	type ShopTrustChanged,
	type VerdictRecord,
	type VerdictUpdated,
} from "./events"
import { defineAgent, on } from "./kit"

const NAME = "VerdictAgent"

// VerdictAgent never waits for "all results". Each input updates one field of
// the offer's record and the verdict is recomputed right away, so it can flip
// several times as other agents report in.

/** Recompute one offer and emit verdict.updated if the verdict changed. Returns true if it flipped. */
function rescore(rec: VerdictRecord, selfId: string, cause: string): boolean {
	const { trust, data } = resolveRuntime().state
	const shopName = data.shops.find((s) => s.id === rec.shopId)!.name
	const next = decide(rec, trust.get(rec.shopId)!, shopName)
	const previous = rec.verdict
	rec.reason = next.reason
	rec.updatedAt = Date.now()
	if (next.verdict === previous) return false

	rec.verdict = next.verdict
	const update: VerdictUpdated = { shopId: rec.shopId, skuId: rec.skuId, verdict: next.verdict, previous, reason: next.reason, cause }
	emit(EV.verdictUpdated, selfId, update)
	return true
}

/** The record for this offer, if the result is about its current price (stale results are ignored). */
function current(shopId: string, skuId: string, price: number): VerdictRecord | undefined {
	const rec = resolveRuntime().state.verdicts.get(offerKey(shopId, skuId))
	return rec && rec.price === price ? rec : undefined
}

export const verdictAgent = defineAgent(NAME, "Keeps a live verdict per product and recomputes it whenever any input arrives.", [
	on<PriceChanged>([EV.priceChanged], NAME, async (change, _e, selfId) => {
		const rec: VerdictRecord = { shopId: change.shopId, skuId: change.skuId, price: change.price, verdict: "CHECKING", reason: "", updatedAt: 0 }
		resolveRuntime().state.verdicts.set(offerKey(change.shopId, change.skuId), rec)
		rescore(rec, selfId, EV.priceChanged)
		return `${change.shopId}/${change.skuId} reset`
	}),

	on<DiscountChecked>([EV.discountVerified, EV.discountFake], NAME, async (d, event, selfId) => {
		const rec = current(d.shopId, d.skuId, d.price)
		if (!rec) return "stale"
		rec.discount = { ...d, legal: event.type === EV.discountVerified }
		return `${d.shopId}/${d.skuId} → ${rescore(rec, selfId, event.type) ? rec.verdict : "unchanged"}`
	}),

	on<KpPrice>([EV.kpPrice], NAME, async (kp, event, selfId) => {
		const rec = current(kp.shopId, kp.skuId, kp.shopPrice)
		if (!rec) return "stale"
		rec.kp = kp
		return `${kp.shopId}/${kp.skuId} → ${rescore(rec, selfId, event.type) ? rec.verdict : "unchanged"}`
	}),

	on<CrossShopBest>([EV.crossShopBest], NAME, async (cs, event, selfId) => {
		const rec = current(cs.shopId, cs.skuId, cs.shopPrice)
		if (!rec) return "stale"
		rec.crossShop = cs
		return `${cs.shopId}/${cs.skuId} → ${rescore(rec, selfId, event.type) ? rec.verdict : "unchanged"}`
	}),

	// The cascade: one shop gets caught, every product from that shop is re-scored at once.
	on<ShopTrustChanged>([EV.shopTrustChanged], NAME, async (t, event, selfId) => {
		const recs = [...resolveRuntime().state.verdicts.values()].filter((r) => r.shopId === t.shopId)
		const flipped = recs.filter((r) => rescore(r, selfId, event.type)).length
		return `cascade ${t.shopId} trust ${t.trust}: ${recs.length} re-scored, ${flipped} flipped`
	}),
])
