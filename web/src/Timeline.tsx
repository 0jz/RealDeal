import { useEffect, useRef, useState } from "react"
import type { TimelineStore } from "./stream"

export const LANES = [
	{ agent: "PriceFeed", label: "Price feed", hint: "New Black Friday prices", color: "--ink" },
	{ agent: "ThirtyDayAgent", label: "30-day check", hint: "Is the old price real?", color: "--fake" },
	{ agent: "KPMarketAgent", label: "KP market", hint: "Same model on KP", color: "--kp" },
	{ agent: "CrossShopAgent", label: "Other shops", hint: "Same model elsewhere", color: "--cross" },
	{ agent: "ShopTrustAgent", label: "Shop trust", hint: "Who got caught", color: "--trust" },
	{ agent: "VerdictAgent", label: "Verdict", hint: "Live call per product", color: "--real" },
] as const

const WINDOW_MS = 6000
const LANE_H = 52
const ROW_H = 7
const ROW_GAP = 2
const MAX_ROWS = 5
const AXIS_H = 20

/**
 * One lane per agent. Each bar is one handler run, from when the agent started
 * on an event to when it finished. Bars stacked in a lane are runs of the same
 * agent in flight at once; bars at the same x across lanes are different
 * agents working at the same moment.
 */
export function Timeline({ store }: { store: TimelineStore }) {
	const canvas = useRef<HTMLCanvasElement>(null)
	const [inFlight, setInFlight] = useState(0)
	const peak = useRef(0)
	const [peakShown, setPeakShown] = useState(0)

	useEffect(() => {
		const el = canvas.current!
		const ctx = el.getContext("2d")!
		const styles = getComputedStyle(el)
		const color = (v: string) => styles.getPropertyValue(v).trim()
		const laneColors = LANES.map((l) => color(l.color))
		const grid = color("--rule")
		const muted = color("--muted")
		let raf = 0
		let lastCount = -1

		const draw = () => {
			const dpr = window.devicePixelRatio || 1
			const w = el.clientWidth
			const lanesH = LANES.length * LANE_H
			const h = lanesH + AXIS_H
			if (el.width !== w * dpr || el.height !== h * dpr) {
				el.width = w * dpr
				el.height = h * dpr
			}
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
			ctx.clearRect(0, 0, w, h)

			const now = store.now()
			const x = (t: number) => w - ((now - t) / WINDOW_MS) * w

			// Seconds grid.
			ctx.font = "500 11px Archivo, system-ui, sans-serif"
			ctx.textBaseline = "bottom"
			for (let s = 1; s * 1000 < WINDOW_MS; s++) {
				const gx = Math.round(w - (s * 1000 * w) / WINDOW_MS) + 0.5
				ctx.fillStyle = grid
				ctx.fillRect(gx, 0, 1, lanesH + 4)
				ctx.fillStyle = muted
				if (w > 420 || s % 2 === 0) ctx.fillText(`${s}s ago`, gx + 4, h - 2)
			}
			ctx.fillStyle = muted
			ctx.textAlign = "right"
			ctx.fillText("now", w - 2, h - 2)
			ctx.textAlign = "left"
			for (let i = 1; i <= LANES.length; i++) {
				ctx.fillStyle = grid
				ctx.fillRect(0, i * LANE_H, w, 1)
			}

			// Handler runs, packed into rows per lane so overlapping runs stay visible.
			const byLane = new Map<string, { start: number; end: number; open: boolean }[]>()
			for (const r of store.runs.values()) {
				const end = r.end ?? now
				if (end < now - WINDOW_MS) continue
				const list = byLane.get(r.agent) ?? []
				list.push({ start: r.start, end, open: r.end === null })
				byLane.set(r.agent, list)
			}
			LANES.forEach((lane, li) => {
				const runs = (byLane.get(lane.agent) ?? []).sort((a, b) => a.start - b.start)
				const rowEnd: number[] = []
				const top = li * LANE_H + 8
				for (const r of runs) {
					let row = rowEnd.findIndex((e) => e < r.start)
					if (row < 0) row = rowEnd.length
					rowEnd[row] = r.end
					const y = top + Math.min(row, MAX_ROWS - 1) * (ROW_H + ROW_GAP)
					const x0 = x(r.start)
					const width = Math.max(3, x(r.end) - x0)
					ctx.globalAlpha = r.open ? 1 : 0.78
					ctx.fillStyle = laneColors[li]
					ctx.fillRect(x0, y, width, ROW_H)
				}
				ctx.globalAlpha = 1
			})

			// Emitted events: small ticks on the producing agent's lane.
			for (const e of store.emits) {
				const li = LANES.findIndex((l) => l.agent === e.agent)
				if (li < 0) continue
				const ex = x(e.t)
				if (ex < 0) continue
				ctx.fillStyle = laneColors[li]
				ctx.fillRect(ex - 1, li * LANE_H + LANE_H - 9, 2, 6)
			}

			const n = store.inFlight()
			if (n !== lastCount) {
				lastCount = n
				setInFlight(n)
				if (n > peak.current) {
					peak.current = n
					setPeakShown(n)
				}
			}
			raf = requestAnimationFrame(draw)
		}
		raf = requestAnimationFrame(draw)
		return () => cancelAnimationFrame(raf)
	}, [store])

	return (
		<section className="timeline" aria-label="Live agent timeline">
			<div className="timeline-head">
				<h2>Agents at work</h2>
				<p className="timeline-count">
					<strong>{inFlight}</strong> checks running right now, <strong>{peakShown}</strong> at most
				</p>
			</div>
			<div className="timeline-body">
				<ul className="lanes" style={{ paddingBottom: AXIS_H }}>
					{LANES.map((l) => (
						<li key={l.agent} style={{ height: LANE_H }}>
							<span className="lane-swatch" style={{ background: `var(${l.color})` }} />
							<span>
								<span className="lane-label">{l.label}</span>
								<span className="lane-hint">{l.hint}</span>
							</span>
						</li>
					))}
				</ul>
				<canvas ref={canvas} style={{ height: LANES.length * LANE_H + AXIS_H }} role="img" aria-label="Bars show each agent's checks over the last six seconds; stacked or aligned bars ran at the same time." />
			</div>
		</section>
	)
}
