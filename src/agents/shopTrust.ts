import { emit, resolveRuntime } from "../runtime"
import { EV, type DiscountChecked, type ShopTrustChanged } from "./events"
import { defineAgent, on } from "./kit"

const NAME = "ShopTrustAgent"

/** Trust lost each time a shop is caught with a fake discount. */
export const PENALTY = 10
/** Trust won back for each discount that checks out, so the score tracks how often a shop fakes, not how many products it sells. */
export const RECOVERY = 3

export const shopTrustAgent = defineAgent(NAME, "Keeps a trust score per shop: down when a discount is fake, slowly back up when one checks out.", [
	on<DiscountChecked>([EV.discountFake, EV.discountVerified], NAME, async (d, event, selfId) => {
		const caught = event.type === EV.discountFake
		if (!caught && d.claimedDiscountPct <= 0) return `${d.shopId} no discount claimed`

		const { trust } = resolveRuntime().state
		const previous = trust.get(d.shopId)!
		const next = caught ? Math.max(0, previous - PENALTY) : Math.min(100, previous + RECOVERY)
		if (next === previous) return `${d.shopId} stays ${next}`
		trust.set(d.shopId, next)

		const result: ShopTrustChanged = { shopId: d.shopId, trust: next, previous, skuId: d.skuId, caught }
		emit(EV.shopTrustChanged, selfId, result)
		return `${d.shopId} ${previous} → ${next}`
	}),
])
