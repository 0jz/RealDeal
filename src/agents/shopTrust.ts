import { emit, resolveRuntime } from "../runtime"
import { EV, type DiscountChecked, type ShopTrustChanged } from "./events"
import { defineAgent, on } from "./kit"

const NAME = "ShopTrustAgent"

/** Trust lost each time a shop is caught with a fake discount. */
export const PENALTY = 10

export const shopTrustAgent = defineAgent(NAME, "Keeps a trust score per shop and lowers it when the shop is caught faking a discount.", [
	on<DiscountChecked>([EV.discountFake], NAME, async (fake, _event, selfId) => {
		const { trust } = resolveRuntime().state
		const previous = trust.get(fake.shopId)!
		const next = Math.max(0, previous - PENALTY)
		trust.set(fake.shopId, next)

		const result: ShopTrustChanged = { shopId: fake.shopId, trust: next, previous, caughtSkuId: fake.skuId }
		emit(EV.shopTrustChanged, selfId, result)
		return `${fake.shopId} ${previous} → ${next}`
	}),
])
