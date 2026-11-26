import { useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react"
import type { AgentRun, Command, FinanceView, Goal, PriceSource } from "../../src/finance/types"

export const rsd = (n: number) => `${n.toLocaleString("sr-RS")} RSD`
const roles = ["PurchaseAgent", "ResaleAgent", "ShopTrustAgent", "StrategyAgent"]
const MAX_ITEMS = 5
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`

/** The form keeps numbers as typed text, so a field can be blank ("unknown") while editing. */
export type WishDraft = { id: string; name: string; priority: string; price: string; delivery: string; shop: string; link: string; warrantyMonths: string; condition: "new" | "used" }
export type AssetDraft = { id: string; name: string; condition: "good" | "fair"; expectedPrice: string; fee: string; delivery: string; days: string }
export type Draft = { title: string; cash: string; reserve: string; deadlineDays: string; minWarrantyMonths: string; wishes: WishDraft[]; assets: AssetDraft[] }
export type Product = { id: string; name: string; brand: string; category: string; typicalPrice: number }

const blankWish = (priority: number): WishDraft => ({ id: newId("w"), name: "", priority: String(priority), price: "", delivery: "0", shop: "", link: "", warrantyMonths: "24", condition: "new" })
const blankAsset = (): AssetDraft => ({ id: newId("a"), name: "", condition: "good", expectedPrice: "", fee: "0", delivery: "0", days: "7" })
export const blankDraft = (): Draft => ({ title: "", cash: "", reserve: "0", deadlineDays: "30", minWarrantyMonths: "0", wishes: [blankWish(1)], assets: [] })
const str = (n: number | null) => n == null ? "" : String(n)
export const toDraft = (g: Goal): Draft => ({
	title: g.title, cash: str(g.cash), reserve: str(g.reserve), deadlineDays: str(g.deadlineDays), minWarrantyMonths: str(g.minWarrantyMonths),
	wishes: g.wishes.map(w => ({ ...w, priority: str(w.priority), price: str(w.price), delivery: str(w.delivery), warrantyMonths: str(w.warrantyMonths) })),
	assets: g.assets.map(a => ({ ...a, expectedPrice: str(a.expectedPrice), fee: str(a.fee), delivery: str(a.delivery), days: str(a.days) })),
})
const num = (s: string) => Number(s.trim() === "" ? NaN : s)
const opt = (s: string) => s.trim() === "" ? null : Number(s)
export const toGoal = (d: Draft): Goal => ({
	title: d.title, cash: num(d.cash), reserve: num(d.reserve || "0"), deadlineDays: num(d.deadlineDays), minWarrantyMonths: num(d.minWarrantyMonths || "0"),
	wishes: d.wishes.map(w => ({ ...w, priority: num(w.priority), price: num(w.price), delivery: opt(w.delivery), warrantyMonths: num(w.warrantyMonths || "0") })),
	assets: d.assets.map(a => ({ ...a, expectedPrice: opt(a.expectedPrice), fee: num(a.fee || "0"), delivery: num(a.delivery || "0"), days: num(a.days) })),
})

/** "your price" for prices the user wrote or edited; "typical price (estimate)" for catalogue msrp. */
export const priceLabel = (source?: PriceSource) => source === "catalogue" ? "typical price (estimate)" : "your price"

export function planIdFromUrl() { return new URLSearchParams(location.search).get("plan") }
export function setPlanInUrl(id: string | null) {
	const url = new URL(location.href)
	if (id) url.searchParams.set("plan", id); else url.searchParams.delete("plan")
	history.replaceState(null, "", url)
}

/** Follows a plan's live view over SSE. Close the returned source to stop following. */
export function followPlan(id: string, onView: (view: FinanceView) => void, onError: () => void, onOpen: () => void): EventSource {
	const es = new EventSource(`/api/goal/${id}/stream`)
	es.addEventListener("view", event => onView(JSON.parse((event as MessageEvent).data)))
	es.onerror = onError
	es.onopen = onOpen
	return es
}

/** A rejected command. `view` is the server's current plan when it sent one. */
export class CommandError extends Error {
	view?: FinanceView
	constructor(message: string, view?: FinanceView) {
		super(message)
		this.view = view
	}
}

/** Sends one command against the plan's current revision and resolves with the new view. */
export async function sendCommand(view: FinanceView, command: Command): Promise<FinanceView> {
	const response = await fetch(`/api/goal/${view.id}/command`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: view.revision, requestId: crypto.randomUUID(), command }) })
	const data = await response.json()
	if (!response.ok) throw new CommandError(data.error, data.view)
	return data
}

/** Measured Mozaik loop intervals, fitted to the width. */
function ExecutionTimeline({ runs }: { runs: AgentRun[] }) {
	const [cycle, setCycle] = useState<number | null>(null)
	const cycles = [...new Set(runs.map(r => r.cycle))]
	const shownCycle = cycle != null && cycles.includes(cycle) ? cycle : cycles.at(-1)
	const latest = runs.filter(r => r.cycle === shownCycle)
	if (!latest.length) return null
	const start = Math.min(...latest.map(r => r.startMs))
	const finish = Math.max(...latest.map(r => r.endMs ?? r.startMs))
	const span = Math.max(1, finish - start)
	return <>
		<p className="note">{latest[0].mode === "LLM reasoning" ? "Each agent's explanation comes from a language model; the numbers are always computed by code." : "Each agent checks one part of your plan; the numbers are computed by code."} Bars show when each agent ran.</p>
		<label className="choice">Activity <select aria-label="Activity" value={cycle ?? "latest"} onChange={e => setCycle(e.target.value === "latest" ? null : Number(e.target.value))}><option value="latest">Latest</option>{cycles.map(c => <option key={c} value={c}>{c === 0 ? "First check" : `Update ${c}`}</option>)}</select></label>
		<div className="financial-timeline" role="img" aria-label={`Agent activity over ${span.toFixed(1)} milliseconds`}>
			{roles.map(role => <div className="execution-lane" key={role}><strong>{role}</strong><div className="execution-track">{latest.filter(r => r.agent === role).map(r => <span key={r.id} className={`execution-bar ${r.status}`} style={{ left: `${(r.startMs - start) / span * 100}%`, width: `${Math.max(.4, ((r.endMs ?? finish) - r.startMs) / span * 100)}%` }} title={`${r.agent}: ${r.startedAt} → ${r.finishedAt ?? "running"}; ${r.status}`} />)}</div></div>)}
		</div>
		<div className="intervals"><table><thead><tr><th>Agent</th><th>Started (UTC)</th><th>Duration</th><th>Finding</th></tr></thead><tbody>{latest.map(r => <tr key={r.id}><td>{r.agent}</td><td>{r.startedAt}</td><td>{r.endMs == null ? "running" : `${(r.endMs - r.startMs).toFixed(2)} ms`}</td><td>{r.status}<small>{r.detail}</small></td></tr>)}</tbody></table></div>
	</>
}

/** The full goal form: cash, dates, things to buy and things to sell. */
export function FinanceForm({ draft, setDraft, products, view, busy, onSubmit, onUseExample, onStartOver }: {
	draft: Draft; setDraft: Dispatch<SetStateAction<Draft>>; products: Product[]; view: FinanceView | null; busy: boolean
	onSubmit: (goal: Goal) => void; onUseExample?: () => void; onStartOver?: () => void
}) {
	const typical = (name: string) => products.find(p => p.name.toLowerCase() === name.trim().toLowerCase())?.typicalPrice ?? null
	const patch = (p: Partial<Draft>) => setDraft(d => ({ ...d, ...p }))
	const patchWish = (id: string, p: Partial<WishDraft>) => setDraft(d => ({ ...d, wishes: d.wishes.map(w => w.id === id ? { ...w, ...p } : w) }))
	const patchAsset = (id: string, p: Partial<AssetDraft>) => setDraft(d => ({ ...d, assets: d.assets.map(a => a.id === id ? { ...a, ...p } : a) }))
	const sold = (id: string) => view?.ledger.sold.includes(id)
	const bought = (id: string) => view?.ledger.purchased.includes(id)

	function submit(event: FormEvent) {
		event.preventDefault()
		onSubmit(toGoal(draft))
	}

	return <section className="finder">
		<div className="group-head"><h2>{view ? "Your goal" : "Make a plan"}</h2>{!view && onUseExample && <button type="button" className="ghost" onClick={onUseExample}>Fill with an example</button>}</div>
		<datalist id="product-names">{products.map(p => <option key={p.name} value={p.name}>{p.brand}</option>)}</datalist>
		<form className="finder-form" onSubmit={submit}>
			<label className="field"><span className="label">Name this plan (optional)</span><input value={draft.title} maxLength={300} placeholder="e.g. New phone before the trip" onChange={e => patch({ title: e.target.value })} /></label>
			<div className="fields">
				<label className="field"><span className="label">Cash you have (RSD)</span><input type="number" inputMode="numeric" min="0" max="10000000" step="1" value={draft.cash} onChange={e => patch({ cash: e.target.value })} required /></label>
				<label className="field"><span className="label">Keep untouched (RSD)</span><input type="number" inputMode="numeric" min="0" step="1" value={draft.reserve} onChange={e => patch({ reserve: e.target.value })} /></label>
				<label className="field"><span className="label">Buy within (days)</span><input type="number" min="1" max="365" value={draft.deadlineDays} onChange={e => patch({ deadlineDays: e.target.value })} required /></label>
				<label className="field"><span className="label">Minimum warranty (months)</span><input type="number" min="0" max="60" value={draft.minWarrantyMonths} onChange={e => patch({ minWarrantyMonths: e.target.value })} /></label>
			</div>

			<h3>Things to buy</h3>
			{draft.wishes.map((w, i) => { const t = typical(w.name); return <fieldset className="item-row" key={w.id}>
				<legend>Item {i + 1}</legend>
				<label className="field wide"><span className="label">What</span><input list="product-names" value={w.name} maxLength={100} placeholder="e.g. iPhone 15" onChange={e => patchWish(w.id, { name: e.target.value })} required /></label>
				<label className="field"><span className="label">Price (RSD)</span><input type="number" inputMode="numeric" min="1" step="1" value={w.price} onChange={e => patchWish(w.id, { price: e.target.value })} required /></label>
				<label className="field"><span className="label">Delivery (RSD, blank = unknown)</span><input type="number" inputMode="numeric" min="0" step="1" value={w.delivery} onChange={e => patchWish(w.id, { delivery: e.target.value })} /></label>
				<label className="field"><span className="label">Priority</span><select value={w.priority} onChange={e => patchWish(w.id, { priority: e.target.value })}>{[1, 2, 3, 4, 5].map(p => <option key={p} value={p}>{p === 1 ? "1 (most important)" : p}</option>)}</select></label>
				<label className="field"><span className="label">Shop</span><input value={w.shop} maxLength={100} placeholder="Where you found it" onChange={e => patchWish(w.id, { shop: e.target.value })} /></label>
				<label className="field wide"><span className="label">Link (optional)</span><input type="url" value={w.link} maxLength={500} placeholder="https://" onChange={e => patchWish(w.id, { link: e.target.value })} /></label>
				<label className="field"><span className="label">Warranty (months)</span><input type="number" min="0" max="60" value={w.warrantyMonths} onChange={e => patchWish(w.id, { warrantyMonths: e.target.value })} /></label>
				<label className="field"><span className="label">Condition</span><select value={w.condition} onChange={e => patchWish(w.id, { condition: e.target.value as "new" | "used" })}><option value="new">New</option><option value="used">Used</option></select></label>
				<div className="row-foot">{t ? <span className="note">Typical new price ≈ {rsd(t)}</span> : <span />}{draft.wishes.length > 1 && !bought(w.id) && <button type="button" className="ghost" onClick={() => patch({ wishes: draft.wishes.filter(x => x.id !== w.id) })}>Remove</button>}</div>
			</fieldset> })}
			{draft.wishes.length < MAX_ITEMS && <button type="button" className="ghost" onClick={() => patch({ wishes: [...draft.wishes, blankWish(Math.min(5, draft.wishes.length + 1))] })}>+ Add something to buy</button>}

			<h3>Things you could sell <span className="note">(optional)</span></h3>
			{draft.assets.map((a, i) => { const t = typical(a.name); return <fieldset className="item-row" key={a.id}>
				<legend>Sell {i + 1}</legend>
				<label className="field wide"><span className="label">What</span><input list="product-names" value={a.name} maxLength={100} placeholder="e.g. iPhone 13" onChange={e => patchAsset(a.id, { name: e.target.value })} required /></label>
				<label className="field"><span className="label">Expected price (RSD)</span><input type="number" inputMode="numeric" min="0" step="1" value={a.expectedPrice} placeholder={t ? `blank = estimate ≈ ${(Math.round(t * (a.condition === "good" ? .5 : .4) / 100) * 100).toLocaleString("sr-RS")}` : "What you'd accept"} onChange={e => patchAsset(a.id, { expectedPrice: e.target.value })} required={!t} /></label>
				<label className="field"><span className="label">Condition</span><select value={a.condition} onChange={e => patchAsset(a.id, { condition: e.target.value as "good" | "fair" })}><option value="good">Good</option><option value="fair">Fair</option></select></label>
				<label className="field"><span className="label">Listing fee (RSD)</span><input type="number" min="0" step="1" value={a.fee} onChange={e => patchAsset(a.id, { fee: e.target.value })} /></label>
				<label className="field"><span className="label">Shipping you pay (RSD)</span><input type="number" min="0" step="1" value={a.delivery} onChange={e => patchAsset(a.id, { delivery: e.target.value })} /></label>
				<label className="field"><span className="label">Days to sell</span><input type="number" min="1" max="365" value={a.days} onChange={e => patchAsset(a.id, { days: e.target.value })} required /></label>
				<div className="row-foot"><span />{!sold(a.id) && <button type="button" className="ghost" onClick={() => patch({ assets: draft.assets.filter(x => x.id !== a.id) })}>Remove</button>}</div>
			</fieldset> })}
			{draft.assets.length < MAX_ITEMS && <button type="button" className="ghost" onClick={() => patch({ assets: [...draft.assets, blankAsset()] })}>+ Add something to sell</button>}

			<div className="form-actions"><button className="primary" disabled={busy}>{view ? "Update plan" : "Make my plan"}</button>{view && onStartOver && <button type="button" className="ghost" onClick={onStartOver}>Start a new plan</button>}</div>
		</form>
	</section>
}

/** Record sales and purchases. Used inline on the old form page and in the planner's "Track what you did" dialog. */
export function TrackPanel({ view, busy, saleAmounts, setSaleAmounts, command }: {
	view: FinanceView; busy: boolean; saleAmounts: Record<string, string>; setSaleAmounts: (amounts: Record<string, string>) => void; command: (command: Command) => void
}) {
	const [paidAmounts, setPaidAmounts] = useState<Record<string, string>>({})
	const sold = (id: string) => view.ledger.sold.includes(id)
	const bought = (id: string) => view.ledger.purchased.includes(id)
	return <>
		<p className="note">Record a sale when the money arrives, and a purchase when you pay. The plan updates around it. RealDeal never buys or sells anything itself.</p>
		{view.goal.assets.filter(a => !sold(a.id)).map(a => { const r = view.resale.find(r => r.assetId === a.id); const gross = saleAmounts[a.id] ?? String(r?.gross ?? ""); return <div className="simulation-row" key={a.id}><label className="field"><span className="label">{a.name}: sold for (RSD)</span><input type="number" min={a.fee + a.delivery} step="1" value={gross} onChange={e => setSaleAmounts({ ...saleAmounts, [a.id]: e.target.value })} /></label><button className="ghost" disabled={busy || !gross} onClick={() => command({ type: "confirm-sale", assetId: a.id, gross: Number(gross) })}>Mark as sold</button><p className="note">Minus {rsd(a.fee + a.delivery)} fee and shipping. {r ? `${r.basis === "your price" ? "Your price" : "Rough estimate"} · about ${r.days} days · after fees ${rsd(r.low)}–${rsd(r.high)}` : "No sale price yet."}</p></div> })}
		{view.offers.filter(o => !bought(o.wishId) && !o.blocked).map(o => { const estimate = o.priceSource === "catalogue"; const paid = paidAmounts[o.id] ?? ""; return <div className="simulation-row" key={o.id}><strong>{o.name} · {rsd(o.price + (o.delivery ?? 0))}</strong><span className="price-label">{priceLabel(o.priceSource)}</span>{estimate && <label className="field paid-field"><span className="label">Amount you paid (RSD)</span><input type="number" inputMode="numeric" min="1" step="1" value={paid} onChange={e => setPaidAmounts({ ...paidAmounts, [o.id]: e.target.value })} /></label>}<button className="ghost" disabled={busy || (estimate && !(Number(paid) > 0))} onClick={() => command(estimate ? { type: "buy", offerId: o.id, paid: Number(paid) } : { type: "buy", offerId: o.id })}>Mark as bought</button><button className="ghost" disabled={busy} onClick={() => command({ type: view.ledger.reservations[o.id] ? "release" : "reserve", offerId: o.id })}>{view.ledger.reservations[o.id] ? "Release set-aside cash" : "Set cash aside"}</button></div> })}
		{view.goal.wishes.filter(w => bought(w.id)).map(w => <p className="note" key={w.id}>✓ Bought {w.name}</p>)}
		{view.goal.assets.filter(a => sold(a.id)).map(a => <p className="note" key={a.id}>✓ Sold {a.name}</p>)}
	</>
}

/** The plan itself: headline, metrics, actions, "Track what you did", and the agent details. */
export function PlanResult({ view, busy, saleAmounts, setSaleAmounts, command }: {
	view: FinanceView; busy: boolean; saleAmounts: Record<string, string>; setSaleAmounts: (amounts: Record<string, string>) => void; command: (command: Command) => void
}) {
	const [copied, setCopied] = useState(false)
	const plan = view.plan
	const headline = !plan.actions.length ? "Done. Everything on your list is bought." : !plan.complete ? "Buy what fits now. Wait on the rest." : plan.conditional ? "Sell first, then buy." : "You can afford all of it now."

	async function copyLink() {
		try { await navigator.clipboard.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked: the address bar still has the link */ }
	}

	return <>
		<section className="strategy picks" aria-live="polite">
			<div className="group-head"><h2 id="plan-headline" className="scroll-mt-20">{headline}</h2><span className="tag">{view.pending ? "Checking…" : `Updated ${new Date(view.updatedAt).toLocaleTimeString()}`}</span></div>
			{view.goal.title && <p>{view.goal.title}</p>}
			<div className="finance-metrics"><div><span>Cash you can spend now</span><strong>{rsd(plan.availableCash)}</strong></div><div><span>Expected from sales (not cash yet)</span><strong>{rsd(plan.estimatedResale)}</strong></div><div><span>Planned purchases</span><strong>{rsd(plan.expectedCosts)}</strong></div><div><span>Left after the plan</span><strong>{rsd(plan.projectedRemaining)}</strong></div></div>
			<p className="strategy-reason">{view.reason}</p>
			<ol className="strategy-actions">{plan.actions.map(a => { const o = view.offers.find(o => o.id === a.id); return <li key={`${a.kind}-${a.id}`}><span className={`action-kind ${a.kind}`}>{a.kind}</span><div><h3>{a.name}</h3><p>{a.when}</p><p className="note">{a.why}{o?.link && <> <a href={o.link} target="_blank" rel="noopener noreferrer nofollow">Open offer</a></>}</p>{a.kind === "buy" && o && <p className="price-label">{priceLabel(o.priceSource)}</p>}</div><strong>{a.kind === "sell" ? "+" : a.kind === "buy" ? "−" : ""}{a.amount ? rsd(a.amount) : ""}</strong></li> })}</ol>
			{view.notes.StrategyAgent && <p className="note">{view.notes.StrategyAgent}</p>}
			<details><summary>Offer checks</summary>{view.offers.map(o => <div className="simulation-row" key={o.id}><strong>{o.name} · {rsd(o.price + (o.delivery ?? 0))}{o.delivery == null ? " + unknown delivery" : ""}</strong><p className="note">{o.shop || "No shop named"} · {o.warrantyMonths}-month warranty · {o.condition}{o.typicalPrice ? ` · typical new price ≈ ${rsd(o.typicalPrice)}` : " · not in our catalogue, no typical price"}</p>{o.risks.length > 0 && <ul className={o.blocked ? "risks blocked" : "risks"}>{o.risks.map(r => <li key={r}>{r}</li>)}</ul>}</div>)}<p className="note">These are simple checks on the numbers you entered, not a verdict on any shop.</p></details>
			<details><summary>Money so far</summary><dl className="ledger"><dt>Set aside (including untouched)</dt><dd>{rsd(plan.reservedCash)}</dd><dt>Received from sales</dt><dd>{rsd(plan.confirmedResale)}</dd><dt>Spent on purchases</dt><dd>{rsd(plan.actualCosts)}</dd><dt>Net cost of what's left to do</dt><dd>{rsd(plan.netAcquisitionCost)}</dd><dt>Below typical price (planned)</dt><dd>{rsd(plan.forecastSavings)}</dd><dt>Below typical price (bought)</dt><dd>{rsd(plan.verifiedSavings)}</dd></dl></details>
		</section>
		<section className="sell">
			<h2>Track what you did</h2>
			<TrackPanel view={view} busy={busy} saleAmounts={saleAmounts} setSaleAmounts={setSaleAmounts} command={command} />
		</section>
		<section className="finder plan-link"><h2>Come back later</h2><p className="note">Your plan is saved at this page's address. Bookmark it or copy the link. Anyone with the link can see and change this plan, so share it only with people you trust.</p><button type="button" className="ghost" onClick={copyLink}>{copied ? "Copied" : "Copy link"}</button></section>
		<details className="finder"><summary>How the agents checked this plan</summary><ExecutionTimeline runs={view.runs} /><h3>What changed</h3><ol>{view.history.map(h => <li key={h.revision}>{h.reason}</li>)}</ol></details>
	</>
}

export function Finance() {
	const [draft, setDraft] = useState<Draft>(blankDraft)
	const [products, setProducts] = useState<Product[]>([])
	const [view, setView] = useState<FinanceView | null>(null)
	const [error, setError] = useState("")
	const [busy, setBusy] = useState(false)
	const [loading, setLoading] = useState(!!planIdFromUrl())
	const [saleAmounts, setSaleAmounts] = useState<Record<string, string>>({})
	const stream = useRef<EventSource | null>(null)
	const generation = useRef(0)

	const accept = (next: FinanceView) => setView(old => !old || next.id !== old.id || next.sequence >= old.sequence ? next : old)
	function listen(id: string, gen: number) {
		stream.current?.close()
		stream.current = followPlan(id, next => { if (gen === generation.current) accept(next) }, () => { if (gen === generation.current) setError("Connection interrupted; reconnecting. Your plan is saved.") }, () => { if (gen === generation.current) setError("") })
	}
	useEffect(() => {
		let alive = true
		fetch("/api/products").then(r => r.json()).then(p => { if (alive) setProducts(p) }).catch(() => {})
		const id = planIdFromUrl()
		if (id) {
			const gen = ++generation.current
			fetch(`/api/goal/${encodeURIComponent(id)}`).then(async r => {
				if (!alive) return
				if (!r.ok) { setPlanInUrl(null); setError("That plan link doesn't exist any more. Start a new plan below."); return }
				const v = await r.json() as FinanceView
				setView(v); setDraft(toDraft(v.goal)); listen(v.id, gen)
			}).catch(() => { if (alive) setError("Could not reach the server. Reload to try again.") }).finally(() => { if (alive) setLoading(false) })
		}
		return () => { alive = false; generation.current++; stream.current?.close() }
	}, [])

	async function submit(goal: Goal) {
		if (view) return command({ type: "update-goal", goal })
		const gen = ++generation.current
		setBusy(true); setError(""); setSaleAmounts({})
		try {
			const response = await fetch("/api/goal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(goal) })
			const data = await response.json()
			if (!response.ok) throw new Error(data.error)
			if (gen !== generation.current) return
			setView(data); setPlanInUrl(data.id); listen(data.id, gen)
		} catch (e) { if (gen === generation.current) setError(e instanceof Error ? e.message : String(e)) }
		finally { if (gen === generation.current) setBusy(false) }
	}
	async function command(cmd: Command) {
		if (!view) return
		const gen = generation.current
		setBusy(true); setError("")
		try {
			const next = await sendCommand(view, cmd)
			if (gen !== generation.current) return
			accept(next)
		} catch (e) {
			if (gen === generation.current) {
				if (e instanceof CommandError && e.view) accept(e.view)
				setError(e instanceof Error ? e.message : String(e))
			}
		} finally { if (gen === generation.current) setBusy(false) }
	}
	function startOver() {
		generation.current++; stream.current?.close()
		setView(null); setDraft(blankDraft()); setError(""); setSaleAmounts({}); setPlanInUrl(null)
	}
	async function useExample() {
		try { const g = await (await fetch("/api/goal/example")).json() as Goal; setDraft(toDraft(g)) }
		catch { setError("Could not load the example") }
	}

	return <div className="page finance-page">
		<header className="masthead"><h1>RealDeal</h1><p className="tagline">What you own. What you want. One plan you can afford.</p><p className="note">Enter the offers you found and what your old things could sell for. RealDeal works out what to buy, what to sell first and when, without spending money you don't have yet.</p></header>
		{loading ? <p className="note">Opening your plan…</p> : <FinanceForm draft={draft} setDraft={setDraft} products={products} view={view} busy={busy} onSubmit={submit} onUseExample={useExample} onStartOver={startOver} />}
		{error && <p className="alert" role="alert">{error}</p>}
		{view && <PlanResult view={view} busy={busy} saleAmounts={saleAmounts} setSaleAmounts={setSaleAmounts} command={command} />}
		<footer className="foot">RealDeal doesn't buy, sell or hold money. Prices are the ones you entered; typical prices are rough figures and can be out of date.</footer>
	</div>
}
