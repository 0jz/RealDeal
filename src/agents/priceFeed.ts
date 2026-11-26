import { createHuman } from "@mozaik-ai/core"
import type { Offer } from "../data/types"
import { emit, offerKey, resolveRuntime } from "../runtime"
import { EV, type PriceChanged } from "./events"

/** Simulator, not an LLM: streams Black Friday price changes onto the environment. */
export const priceFeed = createHuman({ name: "PriceFeed", capabilities: [], handlers: [] })

/** Put an offer's Black Friday price on the shelf and announce it. */
export function emitPrice(o: Pick<Offer, "shopId" | "skuId" | "bfPrice" | "shownPrevPrice">): void {
	const change: PriceChanged = { shopId: o.shopId, skuId: o.skuId, price: o.bfPrice, shownPrevPrice: o.shownPrevPrice }
	resolveRuntime().state.prices.set(offerKey(o.shopId, o.skuId), { price: o.bfPrice, shownPrevPrice: o.shownPrevPrice })
	emit(EV.priceChanged, priceFeed.getId(), change)
}

/** Offers that advertise some discount, interleaved so consecutive prices come from different products. */
export function feedQueue(): Offer[] {
	const offers = resolveRuntime().state.data.offers.filter((o) => o.bfPrice !== o.shownPrevPrice)
	return offers.map((o, i) => ({ o, k: (i * 7919) % offers.length })).sort((a, b) => a.k - b.k).map((x) => x.o)
}
