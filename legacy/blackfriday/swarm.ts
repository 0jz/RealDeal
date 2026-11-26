import { createHuman } from "@mozaik-ai/core"
import { EventTypeIs } from "./agents/kit"
import { crossShopAgent } from "./agents/crossShop"
import { EV, type VerdictUpdated } from "./agents/events"
import { kpMarketAgent } from "./agents/kpMarket"
import { emitPrice, feedQueue, priceFeed } from "./agents/priceFeed"
import { shopTrustAgent } from "./agents/shopTrust"
import { thirtyDayAgent } from "./agents/thirtyDay"
import { verdictAgent } from "./agents/verdict"
import { generate } from "./data/generate"
import type { Offer } from "./data/types"
import { initializeRuntime, join, MarketState } from "./runtime"

const BASE_INTERVAL_MS = 900

/** Starts the shared runtime with every agent joined. Call once per process. */
export function startSwarm(seed = 2611) {
	const runtime = initializeRuntime({ state: new MarketState(generate(seed)) })
	for (const p of [priceFeed, thirtyDayAgent, kpMarketAgent, crossShopAgent, shopTrustAgent, verdictAgent]) join(p)
	return runtime.state
}

/** Joins a passive observer that sees every verdict.updated, the same way any agent would. */
export function observeVerdicts(onUpdate: (u: VerdictUpdated & { t: number }) => void, state: MarketState): void {
	join(
		createHuman({
			name: "Dashboard",
			capabilities: [],
			handlers: [
				{
					specification: new EventTypeIs([EV.verdictUpdated]),
					processor: { apply: ({ event }) => onUpdate({ ...(event.payload as VerdictUpdated), t: Date.now() - state.startedAt }) },
				},
			],
		}),
	)
}

/** Black Friday price feed with play/pause, speed and fake-discount injection. */
export class Feed {
	private queue: Offer[] = feedQueue()
	private timer: NodeJS.Timeout | null = null
	emitted = 0
	speed = 1

	constructor(private readonly state: MarketState) {}

	get running() {
		return this.timer !== null
	}
	get total() {
		return this.emitted + this.queue.length
	}

	start(): void {
		if (!this.running && this.queue.length) this.tick()
	}

	pause(): void {
		if (this.timer) clearTimeout(this.timer)
		this.timer = null
	}

	setSpeed(speed: number): void {
		this.speed = speed
	}

	reset(): void {
		this.pause()
		this.state.reset()
		this.queue = feedQueue()
		this.emitted = 0
	}

	/** Takes the next honest offer still waiting and puts it out with an invented "previous price". */
	injectFake(): Offer | null {
		const i = this.queue.findIndex((o) => o.pattern === "honest" || o.pattern === "new-item")
		if (i < 0) return null
		const [o] = this.queue.splice(i, 1)
		const shownPrevPrice = Math.round((o.bfPrice * 1.65) / 100) * 100 - 1
		emitPrice({ ...o, shownPrevPrice })
		this.emitted++
		return o
	}

	private tick = () => {
		const o = this.queue.shift()
		if (!o) {
			this.timer = null
			return
		}
		emitPrice(o)
		this.emitted++
		this.timer = setTimeout(this.tick, BASE_INTERVAL_MS / this.speed)
	}
}
