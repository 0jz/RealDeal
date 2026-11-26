import type { Verdict, VerdictRecord } from "../agents/events"

/** Below this trust score a shop's "deals" are treated with suspicion. */
export const TRUST_THRESHOLD = 60
const KP_MARGIN = 0.95 // sealed KP listing must be at least 5% cheaper
const CROSS_SHOP_MARGIN = 0.98 // another shop must be at least 2% cheaper
const MIN_REAL_DISCOUNT_PCT = 5

const rsd = (n: number) => `${n.toLocaleString("sr-RS")} RSD`

/**
 * Rule-based verdict from whatever has been reported so far. Called again on
 * every new input, so the verdict for an offer can change several times.
 */
export function decide(r: VerdictRecord, trust: number, shopName: string): { verdict: Verdict; reason: string } {
	const d = r.discount
	if (!d) return { verdict: "CHECKING", reason: "Waiting for the 30-day check" }

	if (!d.legal) {
		return {
			verdict: "FAKE DISCOUNT",
			reason: `Claims -${d.claimedDiscountPct}%, but the real ${d.windowDays}-day low was ${rsd(d.realLow)} (real ${d.realDiscountPct}%)`,
		}
	}
	if (r.kp?.sealedLow != null && r.kp.sealedLow < r.price * KP_MARGIN) {
		return { verdict: "BUY ON KP INSTEAD", reason: `Sealed on KP for ${rsd(r.kp.sealedLow)} vs ${rsd(r.price)} here` }
	}
	if (r.crossShop?.bestPrice != null && r.crossShop.bestPrice < r.price * CROSS_SHOP_MARGIN) {
		return { verdict: "WAIT", reason: `Cheaper at ${r.crossShop.bestShopId}: ${rsd(r.crossShop.bestPrice)}` }
	}
	if (trust < TRUST_THRESHOLD) {
		return { verdict: "WAIT", reason: `${shopName} was caught faking discounts (trust ${trust}/100)` }
	}
	if (d.realDiscountPct >= MIN_REAL_DISCOUNT_PCT) {
		return { verdict: "REAL DEAL", reason: `Really ${d.realDiscountPct}% below the ${d.windowDays}-day low` }
	}
	return { verdict: "WAIT", reason: `Only ${d.realDiscountPct}% below the ${d.windowDays}-day low` }
}
