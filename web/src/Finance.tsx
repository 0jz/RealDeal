import { useEffect, useRef, useState, type FormEvent } from "react"
import type { AgentRun, Command, FinanceView, Goal } from "../../src/finance/types"
import { checkThirtyDay } from "../../src/rules/thirtyDay"

const rsd = (n: number) => `${n.toLocaleString("sr-RS")} RSD`
const roles = ["PurchaseAgent", "ResaleAgent", "ShopTrustAgent", "StrategyAgent"]

/** Fit measured intervals to the available width, so fast offline I/O remains inspectable. */
function ExecutionTimeline({ runs }: { runs: AgentRun[] }) {
	const [cycle, setCycle] = useState<number | null>(null)
	const cycles = [...new Set(runs.map(r => r.cycle))]
	const shownCycle = cycle != null && cycles.includes(cycle) ? cycle : cycles.at(-1)
	const latest = runs.filter(r => r.cycle === shownCycle)
	const start = Math.min(...latest.map(r => r.startMs))
	const finish = Math.max(...latest.map(r => r.endMs ?? r.startMs))
	const span = Math.max(1, finish - start)
	const points = latest.flatMap(r => [{ t: r.startMs, delta: 1 }, ...(r.endMs == null ? [] : [{ t: r.endMs, delta: -1 }])]).sort((a, b) => a.t - b.t || a.delta - b.delta)
	let count = 0, peak = 0
	for (const p of points) { count += p.delta; peak = Math.max(peak, count) }
	return <section className="timeline">
		<div className="timeline-head"><h2>Agents working together</h2><p>Peak <strong>{peak}</strong> overlapping loops · {span.toFixed(1)} ms shown</p></div>
		<p className="note">{latest[0]?.mode ?? "Offline analysis"} · Actual Mozaik loop intervals. Offline work reads synthetic files asynchronously; no artificial delays.</p>
		<label className="choice">Recorded activity <select aria-label="Recorded activity" value={cycle ?? "latest"} onChange={e => setCycle(e.target.value === "latest" ? null : Number(e.target.value))}><option value="latest">Latest activity</option>{cycles.map(c => <option key={c} value={c}>{c === 0 ? "Initial concurrent analysis" : `Update ${c}`}</option>)}</select></label>
		<div className="financial-timeline" role="img" aria-label={`${peak} overlapping Mozaik loops; ${span.toFixed(1)} milliseconds`}>
			{roles.map(role => <div className="execution-lane" key={role}><strong>{role}</strong><div className="execution-track">{latest.filter(r => r.agent === role).map(r => <span key={r.id} className={`execution-bar ${r.status}`} style={{ left: `${(r.startMs - start) / span * 100}%`, width: `${Math.max(.4, ((r.endMs ?? finish) - r.startMs) / span * 100)}%` }} title={`${r.agent}: ${r.startedAt} → ${r.finishedAt ?? "running"}; ${r.status}`} />)}</div></div>)}
		</div>
		<details><summary>Measured intervals and interception evidence</summary><div className="intervals"><table><thead><tr><th>Agent</th><th>Started (UTC)</th><th>Duration</th><th>Outcome</th></tr></thead><tbody>{latest.map(r => <tr key={r.id}><td>{r.agent}</td><td>{r.startedAt}</td><td>{r.endMs == null ? "running" : `${(r.endMs - r.startMs).toFixed(2)} ms`}</td><td>{r.status}<small>{r.detail}</small></td></tr>)}</tbody></table></div></details>
	</section>
}

export function Finance() {
	const [goal, setGoal] = useState<Goal | null>(null)
	const [view, setView] = useState<FinanceView | null>(null)
	const [error, setError] = useState("")
	const [busy, setBusy] = useState(false)
	const [saleAmounts, setSaleAmounts] = useState<Record<string, string>>({})
	const stream = useRef<EventSource | null>(null)
	const generation = useRef(0)
	useEffect(() => {
		let alive = true
		fetch("/api/goal/demo").then(r => r.json()).then(g => { if (alive) setGoal(g) }).catch(() => { if (alive) setError("Could not load the demo. Check the server and reload.") })
		return () => { alive = false; generation.current++; stream.current?.close() }
	}, [])
	const accept = (next: FinanceView) => setView(old => !old || next.id !== old.id || next.sequence >= old.sequence ? next : old)
	async function create(event: FormEvent) {
		event.preventDefault()
		if (!goal) return
		const gen = ++generation.current
		stream.current?.close(); setBusy(true); setError(""); setSaleAmounts({})
		try {
			const response = await fetch("/api/goal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(goal) })
			const data = await response.json()
			if (!response.ok) throw new Error(data.error)
			if (gen !== generation.current) return
			setView(data)
			const es = new EventSource(`/api/goal/${data.id}/stream`)
			stream.current = es
			es.addEventListener("view", event => { if (gen === generation.current) accept(JSON.parse((event as MessageEvent).data)) })
			es.onerror = () => { if (gen === generation.current) setError("Live connection interrupted; reconnecting. Current plan is retained.") }
			es.onopen = () => { if (gen === generation.current) setError("") }
		} catch (e) { if (gen === generation.current) setError(String(e)) }
		finally { if (gen === generation.current) setBusy(false) }
	}
	async function command(command: Command) {
		if (!view) return
		const gen = generation.current
		setBusy(true); setError("")
		try {
			const response = await fetch(`/api/goal/${view.id}/command`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: view.revision, requestId: crypto.randomUUID(), command }) })
			const data = await response.json()
			if (gen !== generation.current) return
			if (!response.ok) { if (data.view) accept(data.view); throw new Error(data.error) }
			accept(data)
		} catch (e) { if (gen === generation.current) setError(String(e)) }
		finally { if (gen === generation.current) setBusy(false) }
	}
	const patchGoal = (patch: Partial<Goal>) => setGoal(g => g ? { ...g, ...patch } : g)
	const plan = view?.plan
	return <div className="page finance-page">
		<header className="masthead"><span className="section-title">TEAM JDI · BUY + SELL</span><h1>RealDeal</h1><p className="tagline">What you own. What you want. One plan you can afford.</p><p className="note">Synthetic market data · All transactions are simulated · No listings or payments are sent</p></header>
		<section className="finder">
			<h2>Your financial goal</h2>
			{goal && <form className="finder-form" onSubmit={create}>
				<label className="field"><span className="label">What do you want to achieve?</span><input value={goal.title} maxLength={300} onChange={e => patchGoal({ title: e.target.value })} required /></label>
				<div className="fields"><label className="field"><span className="label">Cash in hand (RSD)</span><input type="number" min="0" max="10000000" step="1" value={goal.cash} onChange={e => patchGoal({ cash: Number(e.target.value) })} required /></label><label className="field"><span className="label">Keep untouched (RSD)</span><input type="number" min="0" step="1" value={goal.reserve} onChange={e => patchGoal({ reserve: Number(e.target.value) })} required /></label></div>
				<div className="fields"><div><h3>I want to buy</h3>{[{ id: "phone", productId: "iphone-15", name: "iPhone 15", priority: 1 }, { id: "audio", productId: "headphones-demo", name: "Wireless headphones", priority: 2 }].map(w => <label className="choice" key={w.id}><input type="checkbox" checked={goal.wishes.some(x => x.id === w.id)} onChange={e => patchGoal({ wishes: e.target.checked ? [...goal.wishes, w] : goal.wishes.filter(x => x.id !== w.id) })} />{w.name} · priority {w.priority}</label>)}</div><div><h3>I could sell</h3>{[{ id: "old-phone", productId: "iphone-13", name: "My iPhone 13", condition: "good" as const, fee: 500, delivery: 500 }, { id: "old-laptop", productId: "laptop-demo", name: "My unused laptop", condition: "good" as const, fee: 500, delivery: 500 }].map(a => <label className="choice" key={a.id}><input type="checkbox" checked={goal.assets.some(x => x.id === a.id)} onChange={e => patchGoal({ assets: e.target.checked ? [...goal.assets, a] : goal.assets.filter(x => x.id !== a.id) })} />{a.name}</label>)}</div></div>
				<details><summary>Condition, costs, deadline and quality</summary><div className="fields">
					<label className="field"><span className="label">Purchase deadline (days)</span><input type="number" min="1" max="365" value={goal.deadlineDays} onChange={e => patchGoal({ deadlineDays: Number(e.target.value) })} /></label>
					<label className="field"><span className="label">Minimum seller trust / 100</span><input type="number" min="0" max="100" value={goal.minTrust} onChange={e => patchGoal({ minTrust: Number(e.target.value) })} /></label>
					<label className="field"><span className="label">Minimum warranty (months)</span><input type="number" min="0" max="60" value={goal.minWarrantyMonths} onChange={e => patchGoal({ minWarrantyMonths: Number(e.target.value) })} /></label>
					{goal.assets.map(a => <fieldset key={a.id}><legend>{a.name}</legend><label className="field"><span className="label">Condition</span><select value={a.condition} onChange={e => patchGoal({ assets: goal.assets.map(x => x.id === a.id ? { ...x, condition: e.target.value as "good" | "fair" } : x) })}><option value="good">Good</option><option value="fair">Fair (lower resale estimate)</option></select></label>{(["fee", "delivery"] as const).map(key => <label className="field" key={key}><span className="label">{key === "fee" ? "Assumed selling fee" : "Seller delivery cost"} (RSD)</span><input type="number" min="0" value={a[key]} onChange={e => patchGoal({ assets: goal.assets.map(x => x.id === a.id ? { ...x, [key]: Number(e.target.value) } : x) })} /></label>)}</fieldset>)}
				</div><p className="note">Fees and delivery are editable scenario assumptions, not marketplace tariffs. This focused demo supports these two purchase products and two resale assets.</p></details>
				<button className="primary" disabled={busy || !goal.wishes.length}>{view ? "Start a fresh plan" : "Find my buy + sell strategy"}</button>
			</form>}
		</section>
		{error && <p className="alert" role="alert">{error}</p>}
		{view && plan && <>
			<section className="strategy picks" aria-live="polite"><div className="group-head"><h2>{!plan.complete ? "Keep the priority. Defer the rest." : plan.conditional ? "Sell first. Then upgrade." : "Your goal fits confirmed cash."}</h2><span className="tag">{view.pending ? `${view.pending} agents working` : "Plan updated"} · revision {view.revision}</span></div><p>{view.goal.title}</p>
				<div className="finance-metrics"><div><span>Available cash now</span><strong>{rsd(plan.availableCash)}</strong></div><div><span>Estimated resale · not cash</span><strong>{rsd(plan.estimatedResale)}</strong></div><div><span>Planned purchases</span><strong>{rsd(plan.expectedCosts)}</strong></div><div><span>Projected cash after this plan</span><strong>{rsd(plan.projectedRemaining)}</strong></div></div>
				<p className="strategy-reason">{view.reason}</p>
				<ol className="strategy-actions">{plan.actions.map(a => <li key={`${a.kind}-${a.id}`}><span className={`action-kind ${a.kind}`}>{a.kind}</span><div><h3>{a.name}</h3><p>{a.when}</p><p className="note">{a.why}</p></div><strong>{a.kind === "sell" ? "+" : a.kind === "buy" ? "−" : ""}{rsd(a.amount)}</strong></li>)}</ol>
				{!plan.actions.length && <p>Goal completed in the simulation. Keep the remaining cash.</p>}
				<details><summary>Expected vs confirmed financial outcomes</summary><dl className="ledger"><dt>Reserved cash (including untouched reserve)</dt><dd>{rsd(plan.reservedCash)}</dd><dt>Confirmed simulated resale proceeds</dt><dd>{rsd(plan.confirmedResale)}</dd><dt>Actual simulated purchase costs</dt><dd>{rsd(plan.actualCosts)}</dd><dt>Net cost of remaining acquisition plan</dt><dd>{rsd(plan.netAcquisitionCost)}</dd><dt>Forecast savings vs recorded reference prices</dt><dd>{rsd(plan.forecastSavings)}</dd><dt>Realized savings in this synthetic simulation</dt><dd>{rsd(plan.verifiedSavings)}</dd></dl><p className="note">Projected cash includes uncertain sales and the untouched reserve. Savings use recorded prices, never the advertised discount. No real-world savings are verified.</p></details>
				{view.notes.StrategyAgent && <p className="note">Strategy explanation: {view.notes.StrategyAgent}</p>}
				<details><summary>Offer checks: price, discount and seller risk</summary>{view.offers.map(o => {
					const check = checkThirtyDay({ history: o.history, shownPrevPrice: o.advertisedPrevious }, o.price)
					return <div className="simulation-row" key={o.id}><strong>{o.name} · {rsd(o.price)}</strong><p className={check.legal && o.trust >= view.goal.minTrust ? "note" : "alert"}>{check.status === "misleading-reference" ? `Misleading reference price in synthetic data: advertised ${check.claimedDiscountPct}% off, observed reduction ${check.realDiscountPct}%. Previous-price claim ${rsd(o.advertisedPrevious)} vs recorded low ${rsd(check.realLow)}.` : `Reference check: ${check.status}.`} Seller trust {o.trust}/100; warranty {o.warrantyMonths} months. {o.trust < view.goal.minTrust ? "Blocked by your risk limit." : ""}</p></div>
				})}</details>
			</section>
			<section className="sell"><h2>Try the plan safely</h2><p className="note">These controls change only this in-memory simulation. Confirm a sale only to model receiving its proceeds.</p>
				{view.goal.assets.filter(a => !view.ledger.sold.includes(a.id)).map(a => { const r = view.resale.find(r => r.assetId === a.id); const gross = saleAmounts[a.id] ?? String(r?.gross ?? ""); return <div className="simulation-row" key={a.id}><label className="field"><span className="label">{a.name}: simulated gross sale receipt (RSD)</span><input type="number" min={a.fee + a.delivery} step="1" value={gross} onChange={e => setSaleAmounts({ ...saleAmounts, [a.id]: e.target.value })} /></label><button className="ghost" disabled={busy || !gross} onClick={() => command({ type: "confirm-sale", assetId: a.id, gross: Number(gross) })}>Confirm simulated sale</button><p className="note">Deduct {rsd(a.fee + a.delivery)} fees + delivery. {r ? `${r.confidence} confidence · estimated ${r.days} days · net range ${rsd(r.low)}–${rsd(r.high)}` : "No comparable valuation yet."}</p></div> })}
				{view.offers.filter(o => view.goal.wishes.some(w => w.productId === o.productId && !view.ledger.purchased.includes(w.id)) && o.id !== "phone-ad").map(o => <div className="simulation-row" key={o.id}><strong>{o.name} · {rsd(o.price + (o.delivery ?? 0))}</strong><button className="ghost" disabled={busy} onClick={() => command({ type: "buy", offerId: o.id })}>Simulate purchase</button><button className="ghost" disabled={busy} onClick={() => command({ type: view.ledger.reservations[o.id] ? "release" : "reserve", offerId: o.id })}>{view.ledger.reservations[o.id] ? "Release cash" : "Reserve cash"}</button></div>)}
				<div className="demo-events"><h3>Change the assumptions</h3><button className="ghost" disabled={busy} onClick={() => command({ type: "resale-drop" })}>Resale estimate −10,000 RSD</button><button className="ghost" disabled={busy} onClick={() => command({ type: "cheaper-offer" })}>Phone price → 80,000 RSD</button><button className="ghost" disabled={busy} onClick={() => command({ type: "trust-drop" })}>Seller risk increases</button><button className="ghost" disabled={busy} onClick={() => command({ type: "refresh" })}>Refresh agents</button></div>
			</section>
			<ExecutionTimeline runs={view.runs} />
			<details className="finder"><summary>Why the plan changed</summary><ol>{view.history.map(h => <li key={h.revision}>Revision {h.revision}: {h.reason}</li>)}</ol></details>
		</>}
		<footer className="foot">Focused hackathon prototype. Session data resets when the server restarts. Resale estimates are based on synthetic asking prices, not completed sales.</footer>
	</div>
}
