import { emit, offerKey, resolveRuntime } from "../runtime"
import { EV, type CrossShopBest, type PriceChanged } from "./events"
import { defineAgent, delay, on } from "./kit"

const NAME = "CrossShopAgent"

export const crossShopAgent = defineAgent(NAME, "Compares the same SKU across the other shops.", [
	on<PriceChanged>([EV.priceChanged], NAME, async (change, _event, selfId) => {
		// Simulated latency of querying the other shops.
		await delay(50 + Math.random() * 250)

		const { data, prices } = resolveRuntime().state
		let best: { shopId: string; price: number } | null = null
		for (const o of data.offers) {
			if (o.skuId !== change.skuId || o.shopId === change.shopId) continue
			const p = prices.get(offerKey(o.shopId, o.skuId))!.price
			if (!best || p < best.price) best = { shopId: o.shopId, price: p }
		}

		const result: CrossShopBest = {
			skuId: change.skuId,
			shopId: change.shopId,
			shopPrice: change.price,
			bestShopId: best?.shopId ?? null,
			bestPrice: best?.price ?? null,
		}
		emit(EV.crossShopBest, selfId, result)
		return best ? `${change.skuId} best elsewhere ${best.shopId} ${best.price}${best.price < change.price ? " < this shop" : ""}` : "only seller"
	}),
])
