import { createHuman } from "@mozaik-ai/core"
import { emit, offerKey, resolveRuntime } from "../runtime"
import { EV, type PriceChanged } from "./events"
import { delay } from "./kit"

/** Simulator, not an LLM: streams Black Friday price changes onto the environment. */
export const priceFeed = createHuman({ name: "PriceFeed", capabilities: [], handlers: [] })

export async function runFeed({ count, intervalMs }: { count: number; intervalMs: number }): Promise<void> {
	const offers = resolveRuntime().state.data.offers.filter((o) => o.bfPrice !== o.shownPrevPrice)
	for (let i = 0; i < Math.min(count, offers.length); i++) {
		const o = offers[i]
		const change: PriceChanged = { shopId: o.shopId, skuId: o.skuId, price: o.bfPrice, shownPrevPrice: o.shownPrevPrice }
		resolveRuntime().state.prices.set(offerKey(o.shopId, o.skuId), { price: o.bfPrice, shownPrevPrice: o.shownPrevPrice })
		emit(EV.priceChanged, priceFeed.getId(), change)
		await delay(intervalMs)
	}
}
