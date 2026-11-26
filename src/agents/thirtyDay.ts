import { emit, resolveRuntime } from "../runtime"
import { checkThirtyDay } from "../rules/thirtyDay"
import { EV, type DiscountChecked, type PriceChanged } from "./events"
import { defineAgent, on } from "./kit"

const NAME = "ThirtyDayAgent"

export const thirtyDayAgent = defineAgent(NAME, "Checks advertised discounts against Serbia's 30-day rule.", [
	on<PriceChanged>([EV.priceChanged], NAME, async (change, _event, selfId) => {
		const offer = resolveRuntime().state.data.offers.find((o) => o.shopId === change.shopId && o.skuId === change.skuId)
		if (!offer) return "unknown offer"

		const r = checkThirtyDay({ history: offer.history, shownPrevPrice: change.shownPrevPrice }, change.price)
		const result: DiscountChecked = { ...change, ...r }
		emit(r.legal ? EV.discountVerified : EV.discountFake, selfId, result)
		return `${change.shopId}/${change.skuId} ${r.legal ? "ok" : `FAKE claims -${r.claimedDiscountPct}%, real ${r.realDiscountPct}%`}`
	}),
])
