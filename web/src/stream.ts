import { useEffect, useRef, useState } from "react"

export type Verdict = "CHECKING" | "REAL DEAL" | "FAKE DISCOUNT" | "BUY ON KP INSTEAD" | "WAIT"

export type LogEntry = { t: number; agent: string; kind: "emit" | "start" | "end" | "error"; event: string; run?: number; detail?: string }

export type OfferView = {
	key: string
	shopId: string
	skuId: string
	price: number
	shownPrevPrice: number
	realLow: number | null
	windowDays: number | null
	claimedPct: number | null
	realPct: number | null
	kpSealed: number | null
	bestShopId: string | null
	bestPrice: number | null
	verdict: Verdict
	reason: string
}

export type Flip = { shopId: string; skuId: string; verdict: Verdict; previous: Verdict; reason: string; cause: string; t: number }

export type Snapshot = {
	running: boolean
	speed: number
	emitted: number
	total: number
	trust: Record<string, number>
	offers: OfferView[]
	flips: Flip[]
}

export type Meta = { shops: { id: string; name: string }[]; skus: { id: string; name: string; category: string }[] }

/** Timeline data lives outside React state: the canvas reads it every frame. */
export class TimelineStore {
	runs = new Map<number, { agent: string; start: number; end: number | null }>()
	emits: { agent: string; t: number }[] = []
	private base = { t: 0, perf: 0 }

	/** Align the local clock with the server's run clock (ms since the run started). */
	sync(startedAt: number, serverNow: number) {
		this.base = { t: serverNow - startedAt, perf: performance.now() }
	}
	now() {
		return this.base.t + (performance.now() - this.base.perf)
	}
	clear() {
		this.runs.clear()
		this.emits = []
	}
	add(entries: LogEntry[]) {
		for (const e of entries) {
			if (e.kind === "emit") this.emits.push({ agent: e.agent, t: e.t })
			else if (e.kind === "start" && e.run != null) this.runs.set(e.run, { agent: e.agent, start: e.t, end: null })
			else if (e.run != null) {
				const r = this.runs.get(e.run)
				if (r) r.end = e.t
			}
		}
		// Keep ~20 s of history.
		const cutoff = this.now() - 20_000
		this.emits = this.emits.filter((e) => e.t > cutoff)
		for (const [id, r] of this.runs) if (r.end !== null && r.end < cutoff) this.runs.delete(id)
	}
	inFlight() {
		let n = 0
		for (const r of this.runs.values()) if (r.end === null) n++
		return n
	}
}

export function useStream() {
	const store = useRef(new TimelineStore()).current
	const [meta, setMeta] = useState<Meta | null>(null)
	const [snap, setSnap] = useState<Snapshot | null>(null)
	const [connected, setConnected] = useState(false)

	useEffect(() => {
		const es = new EventSource("/events")
		es.addEventListener("open", () => setConnected(true))
		es.addEventListener("error", () => setConnected(false))
		es.addEventListener("meta", (m) => {
			const d = JSON.parse(m.data)
			store.clear()
			store.sync(d.startedAt, d.now)
			setMeta(d)
		})
		es.addEventListener("reset", (m) => {
			const d = JSON.parse(m.data)
			store.clear()
			store.sync(d.startedAt, d.now)
		})
		es.addEventListener("log", (m) => store.add(JSON.parse(m.data)))
		es.addEventListener("state", (m) => setSnap(JSON.parse(m.data)))
		return () => es.close()
	}, [store])

	return { store, meta, snap, connected }
}

export const command = (path: string) => fetch(`/api/${path}`, { method: "POST" })
