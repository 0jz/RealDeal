import { motion, useReducedMotion } from "motion/react"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { AgentBars } from "./AgentBars"
import type { AgentRun, FinanceView } from "../../src/finance/types"

const AGENTS = ["PurchaseAgent", "ResaleAgent", "ShopTrustAgent", "StrategyAgent", "BudgetGuardian", "QueryAgent", "TehnomediaScout", "AnanasScout", "OfficeShoesScout", "GigatronScout", "JudgeAgent", "VerifyAgent"] as const
type Agent = (typeof AGENTS)[number]
const COLOR: Record<Agent, string> = {
	PurchaseAgent: "var(--log-purchase)",
	ResaleAgent: "var(--log-resale)",
	ShopTrustAgent: "var(--log-trust)",
	StrategyAgent: "var(--log-strategy)",
	BudgetGuardian: "var(--log-guardian)",
	QueryAgent: "var(--log-query)",
	TehnomediaScout: "var(--log-scout)",
	AnanasScout: "var(--log-scout)",
	OfficeShoesScout: "var(--log-scout)",
	GigatronScout: "var(--log-scout)",
	JudgeAgent: "var(--log-judge)",
	VerifyAgent: "var(--log-verify)",
}
/** What each agent does when it starts. Matches the roles in src/finance/engine.ts. */
const STARTS: Record<string, string> = {
	PurchaseAgent: "checking your offers against typical prices",
	ResaleAgent: "valuing what you could sell",
	ShopTrustAgent: "running the offer risk checks",
	StrategyAgent: "working out what to buy, sell and wait on",
	QueryAgent: "turning your words into shop searches",
	TehnomediaScout: "searching Tehnomedia",
	AnanasScout: "searching Ananas",
	OfficeShoesScout: "checking Office Shoes",
	GigatronScout: "searching Gigatron",
	JudgeAgent: "scoring listings against what you asked for",
	VerifyAgent: "re-opening the top listings to confirm price and picture",
}

type Tone = "run" | "ok" | "stale" | "error"
type Line = { key: string; at: string; agent: Agent; text: string; tone: Tone }
type Status = "waiting" | "checking" | "done"

/** Every line comes from a real run in the view: its start, its result, and what BudgetGuardian did with it. */
function linesOf(runs: AgentRun[]): Line[] {
	const lines: (Line & { rank: number; id: number })[] = []
	for (const r of runs) {
		const agent = r.agent as Agent
		lines.push({ key: `${r.id}s`, id: r.id, rank: 0, at: r.startedAt, agent, text: STARTS[r.agent] ?? "started", tone: "run" })
		if (r.status === "running" || !r.finishedAt) continue
		if (r.status === "stale") {
			lines.push({ key: `${r.id}x`, id: r.id, rank: 1, at: r.finishedAt, agent: "BudgetGuardian", text: `discarded an outdated ${r.agent} result: the plan changed while it ran`, tone: "stale" })
			continue
		}
		lines.push({ key: `${r.id}e`, id: r.id, rank: 1, at: r.finishedAt, agent, text: r.detail || (r.status === "error" ? "failed" : "done"), tone: r.status === "error" ? "error" : "ok" })
		if (r.status === "accepted" && r.agent !== "StrategyAgent")
			lines.push({ key: `${r.id}g`, id: r.id, rank: 2, at: r.finishedAt, agent: "BudgetGuardian", text: `accepted the ${r.agent} findings and recalculated the plan`, tone: "ok" })
	}
	return lines.sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id || a.rank - b.rank)
}

function statusOf(agent: Agent, view: FinanceView): Status {
	if (agent === "BudgetGuardian") return view.pending > 0 ? "checking" : view.runs.length ? "done" : "waiting"
	const mine = view.runs.filter(r => r.agent === agent)
	if (!mine.length) return "waiting"
	return mine.some(r => r.status === "running") ? "checking" : "done"
}

/** True when every agent run has settled. */
/** The planning agents. Scouts keep running in the background and fill the cards in, so they don't hold the plan back. */
const PLANNERS = new Set(["PurchaseAgent", "ResaleAgent", "ShopTrustAgent", "StrategyAgent"])
export const settled = (view: FinanceView) => {
	const runs = view.runs.filter(r => PLANNERS.has(r.agent))
	return view.pending === 0 && runs.length > 0 && runs.every(r => r.status !== "running")
}

const clock = (iso: string) => {
	const d = new Date(iso)
	return `${d.toLocaleTimeString("en-GB", { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`
}
const duration = (runs: AgentRun[]) => {
	const ends = runs.filter(r => r.endMs != null)
	if (!ends.length) return ""
	const ms = Math.max(...ends.map(r => r.endMs!)) - Math.min(...runs.map(r => r.startMs))
	return ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`
}

/** The agents' status dots: waiting, checking, done. */
function StatusRow({ view }: { view: FinanceView }) {
	return <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
		{AGENTS.map(a => {
			const s = statusOf(a, view)
			return <span key={a} className="inline-flex items-center gap-2" title={s}>
				{s === "checking"
					? <span className="relative inline-flex size-2"><span className="absolute inline-flex size-full rounded-full opacity-60 motion-safe:animate-ping" style={{ background: COLOR[a] }} /><span className="relative inline-flex size-2 rounded-full" style={{ background: COLOR[a] }} /></span>
					: <span className={s === "done" ? "size-2 rounded-full" : "size-2 rounded-full border"} style={s === "done" ? { background: COLOR[a] } : { borderColor: "var(--log-dim)" }} />}
				<span style={{ color: s === "waiting" ? "var(--log-dim)" : COLOR[a] }}>{a}</span>
				<span className="text-[var(--log-dim)]">{s === "done" ? "✓" : s === "checking" ? "checking" : "waiting"}</span>
			</span>
		})}
	</div>
}

/** The text log: one line per agent start, result and BudgetGuardian decision. */
function LogLines({ view }: { view: FinanceView }) {
	const list = useRef<HTMLOListElement>(null)
	const follow = useRef(true)
	const lines = linesOf(view.runs)
	useEffect(() => {
		const el = list.current
		if (el && follow.current) el.scrollTop = el.scrollHeight
	}, [lines.length])
	return <ol
		ref={list}
		onScroll={e => { const el = e.currentTarget; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24 }}
		className="m-0 max-h-72 list-none overflow-y-auto p-0 font-mono text-[13px] leading-6"
	>
		{lines.map(l => <li key={l.key} className="grid grid-cols-[auto_1fr] gap-x-4 sm:grid-cols-[auto_9.5rem_1fr]">
			<time className="text-[var(--log-dim)]" dateTime={l.at}>{clock(l.at)}</time>
			<span className="truncate" style={{ color: COLOR[l.agent] }}>{l.agent}</span>
			<span className={l.tone === "error" ? "col-span-2 text-[var(--log-error)] sm:col-span-1" : l.tone === "stale" ? "col-span-2 text-[var(--log-dim)] sm:col-span-1" : "col-span-2 sm:col-span-1"}>{l.text}</span>
		</li>)}
	</ol>
}

const dark = "rounded-md border border-[var(--log-rule)] bg-[var(--log-bg)] text-left text-[var(--log-ink)]"

/** While the agents check a new plan: their status and live bars. */
export function LiveLog({ view }: { view: FinanceView }) {
	const reduce = useReducedMotion()
	const done = settled(view)
	return <motion.section
		aria-label="Agents checking your plan"
		aria-busy={!done}
		className={`${dark} grid w-full gap-4 overflow-hidden px-4 py-4`}
		initial={reduce ? false : { opacity: 0, y: -8 }}
		animate={{ opacity: 1, y: 0 }}
		transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
	>
		<StatusRow view={view} />
		<AgentBars runs={view.runs} live serverNow={view.nowMs} />
		<p className="m-0 font-mono text-xs text-[var(--log-dim)]" aria-live="polite">{done ? "All checks finished. Opening your plan." : "waiting for the agents…"}</p>
	</motion.section>
}

/** After the reveal: a one-line summary that opens what was understood, then how the agents checked it. */
export function PlanDetails({ view, understood }: { view: FinanceView; understood: ReactNode }) {
	const [open, setOpen] = useState(false)
	// Scouts keep running after the reveal, so say so until every run has ended.
	const agents = new Set(view.runs.map(r => r.agent)).size
	const summary = view.runs.some(r => r.status === "running")
		? `${agents} agents at work: the scouts are still checking the shops`
		: `${agents} agents checked your plan in ${duration(view.runs)}`
	return <section aria-label="Plan details" className="overflow-hidden rounded-md border border-[var(--rule)] bg-[var(--sheet)]">
		<div className={`${dark} flex flex-wrap items-center justify-between gap-3 rounded-none border-0 px-4 py-3 text-sm`}>
			<span>{summary}</span>
			<button type="button" className="rounded border border-[var(--log-rule)] bg-transparent px-3 py-1 text-[var(--log-ink)] hover:border-[var(--log-dim)]" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? "Hide details" : "Show details"}</button>
		</div>
		{open && <div className="grid gap-6 px-4 py-5">
			{understood}
			<div className="grid gap-3">
				<h2 className="m-0">How the agents checked this plan</h2>
				<div className={`${dark} grid gap-4 px-4 py-4`}>
					<StatusRow view={view} />
					<AgentBars runs={view.runs} picker serverNow={view.nowMs} />
					<LogLines view={view} />
				</div>
				<h3 className="m-0">What changed</h3>
				<ol className="m-0">{view.history.map(h => <li key={h.revision}>{h.reason}</li>)}</ol>
			</div>
		</div>}
	</section>
}
