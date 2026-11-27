import { useReducedMotion } from "motion/react"
import { Fragment, useEffect, useRef, useState } from "react"
import type { AgentRun } from "../../src/finance/types"

const LANES = [
	{ agent: "PurchaseAgent", color: "var(--log-purchase)" },
	{ agent: "ResaleAgent", color: "var(--log-resale)" },
	{ agent: "ShopTrustAgent", color: "var(--log-trust)" },
	{ agent: "StrategyAgent", color: "var(--log-strategy)" },
	{ agent: "QueryAgent", color: "var(--log-query)" },
	{ agent: "TehnomediaScout", color: "var(--log-scout)" },
	{ agent: "AnanasScout", color: "var(--log-scout)" },
	{ agent: "OfficeShoesScout", color: "var(--log-scout)" },
	{ agent: "GigatronScout", color: "var(--log-scout)" },
	{ agent: "EponudaScout", color: "var(--log-scout)" },
	{ agent: "CenotekaScout", color: "var(--log-scout)" },
	{ agent: "JudgeAgent", color: "var(--log-judge)" },
	{ agent: "VerifyAgent", color: "var(--log-verify)" },
] as const

const queuedAt = (r: AgentRun) => (r as AgentRun & { queuedMs?: number }).queuedMs ?? r.startMs
const fmt = (ms: number) => ms < 1000 ? `${Math.max(0, ms).toFixed(1)} ms` : `${(ms / 1000).toFixed(1)} s`

export function AgentBars({ runs, live = false, picker = false }: { runs: AgentRun[]; live?: boolean; picker?: boolean }) {
	const reduce = useReducedMotion()
	const [cycle, setCycle] = useState<number | null>(null)
	const [clock, setClock] = useState(() => ({ runs, clientAt: performance.now(), frame: performance.now() }))
	const [sweep, setSweep] = useState<number | null>(null)
	const swept = useRef(false)
	if (clock.runs !== runs) {
		const at = performance.now()
		setClock({ runs, clientAt: at, frame: at })
	}
	const cycles = [...new Set(runs.map(r => r.cycle))]
	const shownCycle = cycle != null && cycles.includes(cycle) ? cycle : cycles.at(-1)
	const shown = runs.filter(r => r.cycle === shownCycle)
	const anyRunning = shown.some(r => r.status === "running")

	useEffect(() => {
		if (!anyRunning) return
		let id = requestAnimationFrame(function tick() {
			setClock(c => ({ ...c, frame: performance.now() }))
			id = requestAnimationFrame(tick)
		})
		return () => cancelAnimationFrame(id)
	}, [anyRunning])

	const start = shown.length ? Math.min(...shown.map(queuedAt)) : 0
	const serverMax = runs.length ? Math.max(...runs.flatMap(r => [r.startMs, r.endMs ?? r.startMs, queuedAt(r)])) : 0
	const now = serverMax + Math.max(0, clock.frame - clock.clientAt)
	const finish = shown.length ? Math.max(...shown.map(r => r.status === "running" ? now : r.endMs ?? r.startMs)) : 0
	const rawSpan = finish - start
	const span = Math.max(1, rawSpan)
	const label = fmt(span)
	const pct = (at: number) => (at - start) / span * 100

	useEffect(() => {
		// Once per mount, when the live run settles: replay the real intervals if they were too fast to watch.
		if (swept.current || !live || anyRunning || !shown.length || rawSpan >= 300 || reduce) return
		swept.current = true
		let id = 0
		const began = performance.now()
		setSweep(0)
		const step = (t: number) => {
			const p = Math.min(1, (t - began) / 550)
			setSweep(p < 1 ? 1 - (1 - p) ** 3 : null)
			if (p < 1) id = requestAnimationFrame(step)
		}
		id = requestAnimationFrame(step)
		return () => { cancelAnimationFrame(id); setSweep(null) }
	}, [anyRunning])

	if (!runs.length) return null

	return <>
		{picker && <label className="mb-2 flex items-center gap-2 font-mono text-xs text-[var(--log-dim)]">Activity
			<select aria-label="Activity" value={cycle ?? "latest"} onChange={e => setCycle(e.target.value === "latest" ? null : Number(e.target.value))} className="rounded border border-[var(--log-rule)] bg-transparent px-2 py-1 text-[var(--log-ink)]">
				<option value="latest">Latest</option>
				{cycles.map(c => <option key={c} value={c} className="bg-[var(--log-bg)] text-[var(--log-ink)]">{c === 0 ? "First check" : `Update ${c}`}</option>)}
			</select>
		</label>}
		<div role="img" aria-label={`Agent activity: ${label}`} className="font-mono text-xs text-[var(--log-ink)]">
			{LANES.map(lane => {
				const mine = shown.filter(r => r.agent === lane.agent)
				return <div key={lane.agent} className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
					<span className="w-[9.5rem] shrink-0 truncate" style={{ color: lane.color }}>{lane.agent}</span>
					<div className="relative h-5 flex-1 border-l border-[var(--log-rule)]" style={{ background: "rgba(255,255,255,.04)" }}>
						<div className="absolute inset-0" style={sweep == null ? undefined : { clipPath: `inset(0 ${100 - sweep * 100}% 0 0)` }}>
							{mine.map(r => {
								const queued = queuedAt(r)
								const end = r.status === "running" ? now : r.endMs ?? r.startMs
								const color = r.status === "stale" ? "var(--kp)" : r.status === "error" ? "var(--log-error)" : lane.color
								return <Fragment key={r.id}>
									{queued < r.startMs && <div title="waiting for its turn" className="absolute top-1/2 -translate-y-1/2 rounded-sm opacity-70" style={{ left: `${pct(queued)}%`, width: `${pct(r.startMs) - pct(queued)}%`, minWidth: 2, height: 6, background: `repeating-linear-gradient(135deg, ${lane.color} 0 2px, transparent 2px 5px)` }} />}
									<div title={`${r.agent} · ${r.status} · ${fmt(Math.max(0, end - r.startMs))}${r.status === "stale" ? " — discarded: the plan changed while it ran" : ""}`} className={`absolute top-1/2 h-3 -translate-y-1/2 rounded-sm ${r.status === "running" ? "motion-safe:animate-pulse" : ""}`} style={{ left: `${pct(r.startMs)}%`, width: `${Math.max(0, pct(end) - pct(r.startMs))}%`, minWidth: 2, background: color }} />
								</Fragment>
							})}
						</div>
						{sweep != null && <div className="pointer-events-none absolute inset-y-0 w-px" style={{ left: `${sweep * 100}%`, background: "var(--log-guardian)" }} />}
					</div>
				</div>
			})}
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--log-dim)]">
				<span>{LANES.filter(l => shown.some(r => r.agent === l.agent)).length} agents · {label}</span>
				<span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-[1px]" style={{ background: "var(--log-purchase)" }} />checked</span>
				<span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-[1px]" style={{ background: "var(--kp)" }} />discarded</span>
				<span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-[1px] opacity-70" style={{ background: "repeating-linear-gradient(135deg, var(--log-purchase) 0 2px, transparent 2px 5px)" }} />waiting</span>
			</div>
		</div>
	</>
}
