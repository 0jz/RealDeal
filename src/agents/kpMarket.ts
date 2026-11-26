import { emit, resolveRuntime } from "../runtime"
import { EV, type KpPrice, type PriceChanged } from "./events"
import { defineAgent, delay, on } from "./kit"

const NAME = "KPMarketAgent"

export const kpMarketAgent = defineAgent(NAME, "Looks up the same model on KP and estimates its market price.", [
	on<PriceChanged>([EV.priceChanged], NAME, async (change, _event, selfId) => {
		// Simulated lookup latency over the offline KP snapshot (no live scraping).
		await delay(100 + Math.random() * 500)

		const listings = resolveRuntime().state.data.kp.filter((k) => k.skuId === change.skuId)
		const low = (cond: string) => {
			const xs = listings.filter((k) => k.condition === cond).sort((a, b) => a.price - b.price)
			return xs[0] ?? null
		}
		const sealed = low("new-sealed")
		const used = low("used")

		const result: KpPrice = {
			skuId: change.skuId,
			shopId: change.shopId,
			shopPrice: change.price,
			sealedLow: sealed?.price ?? null,
			usedLow: used?.price ?? null,
			listingId: sealed?.id ?? null,
		}
		emit(EV.kpPrice, selfId, result)
		if (!sealed) return `${change.skuId} no sealed listing`
		return `${change.skuId} sealed ${sealed.price}${sealed.price < change.price ? " < shop" : ""}`
	}),
])
