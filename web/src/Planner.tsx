import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react"
import type { Asset, Command, FinanceView, Goal, Intent, Wish } from "../../src/finance/types"
import { motion, useReducedMotion } from "motion/react"
import { LiveLog, settled } from "./LiveLog"
import { Landing, SiteNav } from "./Landing"
import { blankDraft, CommandError, followPlan, FinanceForm, planIdFromUrl, PlanResult, priceLabel, rsd, sendCommand, setPlanInUrl, toDraft, type Draft, type Product } from "./Finance"

const MAX_CHARS = 1000
const WARN_CHARS = 800
const MAX_RSD = 10_000_000
/** The prompt page. The server and Vite both serve index.html for it. */
export const ASK_PATH = "/new"
const EXAMPLES = [
	"New phone for 75000 RSD. I can sell my iPhone 13, it's in good shape.",
	"Hoću iPhone 15 za 85k, prodajem stari ajfon 13",
	"Laptop do 100 hiljada",
]

/** What the server said it could not match. Rendered as text only. */
type Miss = { message: string; unknown: string[] }
/** The interpretation and swap candidates. The server may not resend them after an update, so they stay here. */
type Kept = { intent: Intent; alternatives: Record<string, string[]> }

/** The title the planner gives a goal, built like choose.ts does: "iPhone 15, sell iPhone 13". */
const autoTitle = (goal: Goal) => [...goal.wishes.map(w => w.name), ...goal.assets.map(a => `sell ${a.name}`)].join(", ").slice(0, 300)
/** Keeps a generated title in step with the items. A title the user typed is left alone. */
const retitle = (before: Goal, after: Goal): Goal => before.title === autoTitle(before) ? { ...after, title: autoTitle(after) || after.title } : after

export function Planner() {
	const [text, setText] = useState("")
	const [catalogue, setCatalogue] = useState<Product[]>([])
	const [view, setView] = useState<FinanceView | null>(null)
	const [kept, setKept] = useState<Kept | null>(null)
	const [draft, setDraft] = useState<Draft>(blankDraft)
	const [editing, setEditing] = useState(false)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState("")
	const [miss, setMiss] = useState<Miss | null>(null)
	const [loading, setLoading] = useState(!!planIdFromUrl())
	const [saleAmounts, setSaleAmounts] = useState<Record<string, string>>({})
	/** checking: the agents are running on a new plan and the log is showing. revealed: the plan is shown after a live check. */
	const [phase, setPhase] = useState<"idle" | "checking" | "revealed">("idle")
	const reduce = useReducedMotion()
	const stream = useRef<EventSource | null>(null)
	const generation = useRef(0)

	const accept = (next: FinanceView) => setView(old => !old || next.id !== old.id || next.sequence >= old.sequence ? next : old)
	const adopt = (next: FinanceView) => {
		accept(next)
		if (next.intent) setKept({ intent: next.intent, alternatives: next.alternatives ?? {} })
	}
	function listen(id: string, gen: number) {
		stream.current?.close()
		stream.current = followPlan(id, next => { if (gen === generation.current) adopt(next) }, () => { if (gen === generation.current) setError("Connection interrupted; reconnecting. Your plan is saved.") }, () => { if (gen === generation.current) setError("") })
	}

	useEffect(() => {
		let alive = true
		fetch("/api/products").then(r => r.json()).then(p => { if (alive) setCatalogue(p) }).catch(() => {})
		const id = planIdFromUrl()
		if (id) {
			const gen = ++generation.current
			fetch(`/api/goal/${encodeURIComponent(id)}`).then(async r => {
				if (!alive) return
				if (!r.ok) { setPlanInUrl(null); setError("That plan link doesn't exist any more. Make a new plan below."); return }
				const v = await r.json() as FinanceView
				setDraft(toDraft(v.goal)); adopt(v); listen(v.id, gen)
			}).catch(() => { if (alive) setError("Could not reach the server. Reload to try again.") }).finally(() => { if (alive) setLoading(false) })
		}
		return () => { alive = false; generation.current++; stream.current?.close() }
	}, [])

	/** Asks the server for a plan from the prompt. A 422 means nothing matched, so no plan is created. */
	async function plan() {
		const prompt = text.trim()
		if (!prompt || busy) return
		const gen = ++generation.current
		setBusy(true); setError(""); setMiss(null)
		try {
			const response = await fetch("/api/goal/from-prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) })
			const data = await response.json()
			if (gen !== generation.current) return
			if (response.status === 422) { setMiss({ message: data.error, unknown: Array.isArray(data.unknown) ? data.unknown : [] }); return }
			if (!response.ok) throw new Error(data.error)
			setDraft(toDraft(data.goal)); adopt(data); setPhase("checking"); setPlanInUrl(data.id); listen(data.id, gen)
		} catch (e) { if (gen === generation.current) setError(e instanceof Error ? e.message : String(e)) }
		finally { if (gen === generation.current) setBusy(false) }
	}

	// Once every agent has settled, leave the log readable for a moment, then show the plan.
	useEffect(() => {
		if (phase !== "checking" || !view || !settled(view)) return
		const t = setTimeout(() => setPhase("revealed"), 600)
		return () => clearTimeout(t)
	}, [phase, view])
	useEffect(() => {
		if (phase !== "revealed") return
		requestAnimationFrame(() => document.getElementById("plan-headline")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }))
	}, [phase])

	/** Sends a change to the open plan. The draft follows the goal the server accepted. */
	async function send(cmd: Command) {
		if (!view) return
		const gen = generation.current
		setBusy(true); setError("")
		try {
			const next = await sendCommand(view, cmd)
			if (gen !== generation.current) return
			adopt(next); setDraft(toDraft(next.goal))
		} catch (e) {
			if (gen === generation.current) {
				if (e instanceof CommandError && e.view) accept(e.view)
				setError(e instanceof Error ? e.message : String(e))
			}
		} finally { if (gen === generation.current) setBusy(false) }
	}

	function newPlan() {
		generation.current++; stream.current?.close()
		history.replaceState(null, "", ASK_PATH)
		setView(null); setKept(null); setPhase("idle"); setDraft(blankDraft()); setEditing(false); setText(""); setError(""); setMiss(null); setSaleAmounts({}); setBusy(false); setPlanInUrl(null)
	}

	const onPromptKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void plan() }
	}

	if (loading) return <main className="page"><p className="note">Opening your plan…</p></main>

	const checking = phase === "checking"

	// The front page is "/". The prompt page with the test prompts is ASK_PATH; a broken plan link also lands there to show its error.
	if (!view && location.pathname !== ASK_PATH && !error) return <Landing />

	if (!view || checking) return <main className="page ask-page">
		<section className="ask" aria-labelledby="ask-title">
			<p className="brand"><a href="/">RealDeal</a></p>
			<h1 id="ask-title">What do you want to buy or sell?</h1>
			<div className="ask-box">
				<label className="field"><span className="sr-only">Describe what you want to buy or sell</span>
					<textarea value={text} maxLength={MAX_CHARS} rows={1} placeholder="e.g. New phone for 75000 RSD. I can sell my old iPhone 13." aria-describedby="ask-count" onChange={e => setText(e.target.value)} onKeyDown={onPromptKey} readOnly={checking} />
				</label>
				<div className="ask-foot">
					<span id="ask-count" className={text.length >= WARN_CHARS ? "counter near" : "counter"} aria-live="polite">{text.length >= WARN_CHARS ? `${text.length}/${MAX_CHARS}` : ""}</span>
					<button type="button" className="primary" disabled={busy || checking || !text.trim()} onClick={() => void plan()}>{busy || checking ? "Checking…" : "Make my plan"}</button>
				</div>
			</div>
			{miss && <p className="alert" role="alert">{miss.unknown.length ? `I couldn't match: ${miss.unknown.join(", ")}` : miss.message}</p>}
			{error && <p className="alert" role="alert">{error}</p>}
			{view && checking && <LiveLog view={view} />}
			{!checking && <div className="examples">
				<p className="label">Or try one of these</p>
				<ul>{EXAMPLES.map(ex => <li key={ex}><button type="button" onClick={() => setText(ex)}>{ex}</button></li>)}</ul>
			</div>}
		</section>
	</main>

	const alternativesFor = (wish: Wish) => (kept?.alternatives[wish.id] ?? [])
		.map(id => catalogue.find(p => p.id === id))
		.filter((p): p is Product => !!p && p.name !== wish.name)

	return <><SiteNav action={<button type="button" className="ghost" onClick={newPlan}>New plan</button>} />
	<motion.div className="page finance-page planner-page" initial={phase === "revealed" && !reduce ? { opacity: 0, y: 12 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}>
		{error && <p className="alert" role="alert">{error}</p>}
		{phase === "revealed" && <LiveLog view={view} collapsed />}

		<section className="understood" aria-label="What I understood">
			<div className="group-head"><h2>What I understood</h2><span className="note">Tap a chip to change it. The plan updates right away.</span></div>
			<ul className="chip-row">
				{view.goal.wishes.map(w => <ChipEditor key={w.id} label={`buy: ${w.name}`}>
					{() => <WishEditor wish={w} goal={view.goal} options={alternativesFor(w)} busy={busy} onApply={goal => void send({ type: "update-goal", goal: retitle(view.goal, goal) })} />}
				</ChipEditor>)}
				{view.goal.assets.map(a => <ChipEditor key={a.id} label={`sell: ${a.name}, ${a.condition}`}>
					{() => <AssetEditor asset={a} goal={view.goal} busy={busy} onApply={goal => void send({ type: "update-goal", goal: retitle(view.goal, goal) })} />}
				</ChipEditor>)}
			</ul>
		</section>

		<div className="planner-actions">
			<button type="button" className="ghost" aria-expanded={editing} onClick={() => setEditing(!editing)}>{editing ? "Hide details" : "Edit details"}</button>
		</div>
		{editing && <FinanceForm draft={draft} setDraft={setDraft} products={catalogue} view={view} busy={busy} onSubmit={goal => void send({ type: "update-goal", goal })} />}

		<PlanResult view={view} busy={busy} saleAmounts={saleAmounts} setSaleAmounts={setSaleAmounts} command={cmd => void send(cmd)} />
		<footer className="foot">RealDeal doesn't buy, sell or hold money. Prices are the ones you entered; typical prices are rough figures and can be out of date.</footer>
	</motion.div></>
}

/** A chip that opens a small popover. Closes on Escape or a click outside. */
function ChipEditor({ label, children }: { label: string; children: () => ReactNode }) {
	const [open, setOpen] = useState(false)
	const wrap = useRef<HTMLLIElement>(null)
	const button = useRef<HTMLButtonElement>(null)
	const pop = useRef<HTMLDivElement>(null)

	// A swap or edit renames the chip: the change is applied, so close.
	useEffect(() => setOpen(false), [label])
	useEffect(() => {
		if (!open) return
		pop.current?.focus()
		const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
		const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus() } }
		document.addEventListener("mousedown", onDown)
		document.addEventListener("keydown", onKey)
		return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey) }
	}, [open])

	return <li className="chip-wrap" ref={wrap}>
		<button ref={button} type="button" className="chip" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(o => !o)}>{label} <span aria-hidden="true">▾</span></button>
		{open && <div ref={pop} className="pop" role="dialog" aria-label={label} tabIndex={-1}>{children()}</div>}
	</li>
}

function WishEditor({ wish, goal, options, busy, onApply }: { wish: Wish; goal: Goal; options: Product[]; busy: boolean; onApply: (goal: Goal) => void }) {
	const [price, setPrice] = useState("")
	const replace = (next: Wish) => onApply({ ...goal, wishes: goal.wishes.map(w => w.id === wish.id ? next : w) })
	const n = Number(price)
	const priceOk = Number.isInteger(n) && n > 0 && n <= MAX_RSD

	return <>
		<p className="pop-title">Buy: {wish.name}</p>
		<p className="note">{rsd(wish.price)} · {priceLabel(wish.priceSource)}</p>
		{options.length > 0 && <div className="pop-block">
			<h3>Swap for</h3>
			<ul className="swap-list">{options.map(p => <li key={p.id}><button type="button" disabled={busy} onClick={() => replace({ ...wish, name: p.name, price: p.typicalPrice, priceSource: "catalogue", delivery: null })}><span>{p.name}</span><span className="note">typical {rsd(p.typicalPrice)}</span></button></li>)}</ul>
		</div>}
		<div className="pop-block">
			<label className="field"><span className="label">Your price (RSD)</span>
				<span className="pop-row"><input type="number" inputMode="numeric" min="1" step="1" value={price} placeholder={String(wish.price)} onChange={e => setPrice(e.target.value)} />
					<button type="button" className="ghost" disabled={busy || !priceOk} onClick={() => { replace({ ...wish, price: n, priceSource: "you" }); setPrice("") }}>Save price</button></span>
			</label>
		</div>
		<div className="pop-foot">
			<button type="button" className="ghost" disabled={busy || goal.wishes.length <= 1} onClick={() => onApply({ ...goal, wishes: goal.wishes.filter(w => w.id !== wish.id) })}>Remove</button>
			{goal.wishes.length <= 1 && <span className="note">A plan needs at least one thing to buy.</span>}
		</div>
	</>
}

function AssetEditor({ asset, goal, busy, onApply }: { asset: Asset; goal: Goal; busy: boolean; onApply: (goal: Goal) => void }) {
	const [price, setPrice] = useState("")
	const replace = (next: Asset) => onApply({ ...goal, assets: goal.assets.map(a => a.id === asset.id ? next : a) })
	const blank = price.trim() === ""
	const n = blank ? null : Number(price)
	const priceOk = n === null || (Number.isInteger(n) && n >= 0 && n <= MAX_RSD)

	return <>
		<p className="pop-title">Sell: {asset.name}</p>
		<p className="note">{asset.expectedPrice != null ? `${rsd(asset.expectedPrice)} · your price` : "Estimated from the typical price"}</p>
		<div className="pop-block">
			<label className="field"><span className="label">Condition</span>
				<select value={asset.condition} disabled={busy} onChange={e => replace({ ...asset, condition: e.target.value as "good" | "fair" })}><option value="good">Good</option><option value="fair">Fair</option></select>
			</label>
		</div>
		<div className="pop-block">
			<label className="field"><span className="label">Expected price (RSD, blank = estimate)</span>
				<span className="pop-row"><input type="number" inputMode="numeric" min="0" step="1" value={price} placeholder={asset.expectedPrice != null ? String(asset.expectedPrice) : "estimate"} onChange={e => setPrice(e.target.value)} />
					<button type="button" className="ghost" disabled={busy || !priceOk || (blank && asset.expectedPrice == null)} onClick={() => { replace({ ...asset, expectedPrice: n }); setPrice("") }}>Save price</button></span>
			</label>
		</div>
		<div className="pop-foot">
			<button type="button" className="ghost" disabled={busy} onClick={() => onApply({ ...goal, assets: goal.assets.filter(a => a.id !== asset.id) })}>Remove</button>
		</div>
	</>
}
