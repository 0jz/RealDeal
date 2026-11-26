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

const plantedFake = (o: Offer) => o.pattern === "presale-hike" || o.pattern === "inflated-prev"

/**
 * Offers that advertise some discount, in a scripted order so the demo tells a story:
 * 1. the worst shop's honest offers come in among the others (some become REAL DEAL),
 * 2. then its fakes arrive one after another, trust drops under the threshold and
 *    the cascade puts its earlier deals on hold,
 * 3. then the rest of the market.
 * The feed is a simulator; it knows the planted patterns, the agents do not.
 */
export function feedQueue(): Offer[] {
	const { offers, shops } = resolveRuntime().state.data
	const listed = offers.filter((o) => o.bfPrice !== o.shownPrevPrice)
	const mixed = listed.map((o, i) => ({ o, k: (i * 7919) % listed.length })).sort((a, b) => a.k - b.k).map((x) => x.o)

	const fakes = (id: string) => mixed.filter((o) => o.shopId === id && plantedFake(o)).length
	const worst = shops.reduce((a, b) => (fakes(b.id) > fakes(a.id) ? b : a)).id
	const honest = mixed.filter((o) => o.shopId === worst && !plantedFake(o))
	const caught = mixed.filter((o) => o.shopId === worst && plantedFake(o))
	const rest = mixed.filter((o) => o.shopId !== worst)

	const out: Offer[] = []
	for (const o of honest) out.push(...rest.splice(0, 2), o)
	for (const o of caught) out.push(...rest.splice(0, 1), o)
	return [...out, ...rest]
}
