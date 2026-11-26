import { useCallback, useEffect, useRef, useState } from "react"
import type { SearchRequest, SearchView } from "./types"

export type LogEntry = {
	t: number
	agent: string
	kind: "emit" | "start" | "end" | "error"
	event: string
	run?: number
	detail?: string
	searchId?: string
}

/** Timeline data lives outside React state: the canvas reads it every frame. */
export class TimelineStore {
	runs = new Map<number, { agent: string; start: number; end: number | null }>()
	emits: { agent: string; t: number }[] = []
	private base = { t: 0, perf: 0 }

	/** Align the local clock with the server's run clock (ms since the search started). */
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

const FAILED = "Pretraga nije uspela. Proveri da li server radi i pokušaj ponovo."

/** Starts a search on the server and follows its live view over SSE. */
export function useSearch() {
	const store = useRef(new TimelineStore()).current
	const [view, setView] = useState<SearchView | null>(null)
	const [running, setRunning] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const source = useRef<EventSource | null>(null)

	const close = useCallback(() => {
		source.current?.close()
		source.current = null
	}, [])

	useEffect(() => close, [close])

	const run = useCallback(
		async (request: SearchRequest) => {
			close()
			store.clear()
			setView(null)
			setError(null)
			setRunning(true)
			try {
				const res = await fetch("/api/search", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(request),
				})
				if (!res.ok) throw new Error(`POST /api/search ${res.status}`)
				const { id } = (await res.json()) as { id: string }

				const es = new EventSource(`/api/search/${id}/stream`)
				source.current = es
				es.addEventListener("meta", (m: MessageEvent) => {
					const d = JSON.parse(m.data) as { startedAt: number; now: number }
					store.sync(d.startedAt, d.now)
				})
				es.addEventListener("view", (m: MessageEvent) => {
					const v = JSON.parse(m.data) as SearchView
					setView(v)
					if (v.done) {
						close()
						setRunning(false)
					}
				})
				es.addEventListener("log", (m: MessageEvent) => store.add(JSON.parse(m.data) as LogEntry[]))
				es.onerror = () => {
					// The browser retries while CONNECTING; CLOSED means the stream is gone for good.
					if (es.readyState !== EventSource.CLOSED) return
					source.current = null
					setRunning(false)
					setError(FAILED)
				}
			} catch {
				setRunning(false)
				setError(FAILED)
			}
		},
		[close, store],
	)

	return { view, store, running, error, run }
}
