import { useMemo, useState } from "react"
import { command, useStream, type OfferView, type Verdict } from "./stream"
import { Timeline } from "./Timeline"

const rsd = (n: number) => `${n.toLocaleString("sr-RS")} RSD`

const VERDICT_CLASS: Record<Verdict, string> = {
	CHECKING: "checking",
	"REAL DEAL": "real",
	"FAKE DISCOUNT": "fake",
	"BUY ON KP INSTEAD": "kp",
	WAIT: "wait",
}

const FILTERS: Array<{ id: Verdict | "all"; label: string }> = [
	{ id: "all", label: "All" },
	{ id: "FAKE DISCOUNT", label: "Fake discounts" },
	{ id: "REAL DEAL", label: "Real deals" },
	{ id: "BUY ON KP INSTEAD", label: "Cheaper on KP" },
	{ id: "WAIT", label: "Wait" },
]

const TRUST_THRESHOLD = 60

export function App() {
	const { store, meta, snap, connected } = useStream()
	const [filter, setFilter] = useState<Verdict | "all">("all")

	const names = useMemo(() => {
		const shop = new Map(meta?.shops.map((s) => [s.id, s.name]))
		const sku = new Map(meta?.skus.map((s) => [s.id, s.name]))
		return { shop: (id: string | null) => (id ? (shop.get(id) ?? id) : ""), sku: (id: string) => sku.get(id) ?? id }
	}, [meta])

	const offers = useMemo(() => [...(snap?.offers ?? [])].reverse(), [snap])
	const counts = useMemo(() => {
		const c: Record<string, number> = { all: offers.length }
		for (const o of offers) c[o.verdict] = (c[o.verdict] ?? 0) + 1
		return c
	}, [offers])
	const shown = filter === "all" ? offers : offers.filter((o) => o.verdict === filter)

	const running = snap?.running ?? false
	const done = snap ? snap.emitted > 0 && snap.emitted === snap.total : false

	return (
		<div className="page">
			<header className="masthead">
				<div className="brand">
					<h1>RealDeal</h1>
					<p>No fake discounts. Just do it.</p>
				</div>
				<p className="intro">
					Since 1 May 2026 a shop's "previous price" must be its lowest price in the last 30 days. Six agents check every Black Friday price as it
					lands: the 30-day rule, the same model on KP, the other shops, and whether the shop has been caught before.
				</p>
				<div className="controls">
					<button className="primary" onClick={() => command(running ? "pause" : "start")} disabled={!connected || done}>
						{done ? "All prices in" : running ? "Pause" : snap?.emitted ? "Resume" : "Start Black Friday"}
					</button>
					<button aria-pressed={snap?.speed === 10} onClick={() => command(snap?.speed === 10 ? "speed/1" : "speed/10")} disabled={!connected}>
						Speed ×10
					</button>
					<button onClick={() => command("inject")} disabled={!connected || done}>
						Inject fake discount
					</button>
					<button className="quiet" onClick={() => command("reset")} disabled={!connected}>
						Reset
					</button>
					<span className="progress" aria-live="polite">
						{connected ? (snap ? `${snap.emitted} of ${snap.total} prices in` : "Connecting…") : "Server offline. Start it with npm run dev."}
					</span>
				</div>
			</header>

			<Timeline store={store} />

			<main className="board">
				<section className="offers" aria-label="Products">
					<div className="filters" role="tablist">
						{FILTERS.map((f) => (
							<button key={f.id} role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}>
								{f.label} <span className="count">{counts[f.id] ?? 0}</span>
							</button>
						))}
					</div>
					{shown.length === 0 ? (
						<p className="empty">{offers.length === 0 ? "Press Start Black Friday. Prices will appear here as the shops publish them." : "Nothing here yet."}</p>
					) : (
						<ul className="cards">
							{shown.map((o) => (
								<Card key={o.key} o={o} names={names} />
							))}
						</ul>
					)}
				</section>

				<aside className="side">
					<section aria-label="Shop trust">
						<h2>Shop trust</h2>
						<ul className="trust">
							{meta?.shops.map((s) => {
								const t = snap?.trust[s.id] ?? 100
								return (
									<li key={s.id} className={t < TRUST_THRESHOLD ? "low" : ""}>
										<span className="trust-name">{s.name}</span>
										<span className="trust-bar">
											<span style={{ width: `${t}%` }} />
										</span>
										<span className="trust-score">{t}</span>
									</li>
								)
							})}
						</ul>
						<p className="note">Each fake discount costs a shop 10 points. Under {TRUST_THRESHOLD}, its other deals are put on hold.</p>
					</section>

					<section aria-label="Latest verdict changes">
						<h2>Latest changes</h2>
						{snap?.flips.length ? (
							<ol className="flips">
								{snap.flips.slice(0, 14).map((f, i) => (
									<li key={`${f.shopId}${f.skuId}${f.t}${i}`}>
										<span className="flip-what">
											{names.sku(f.skuId)} at {names.shop(f.shopId)}
										</span>
										<span className="flip-change">
											{f.previous === "CHECKING" ? "" : `${label(f.previous)} to `}
											<b className={`v-${VERDICT_CLASS[f.verdict]}`}>{label(f.verdict)}</b>
											{f.cause === "shop.trust.changed" ? ", shop caught" : ""}
										</span>
									</li>
								))}
							</ol>
						) : (
							<p className="note">Verdicts that change show up here.</p>
						)}
					</section>
				</aside>
			</main>

			<footer className="foot">All shops, prices and KP listings are synthetic. Team JDI, JigJoy Black Friday AI Hackathon 2026.</footer>
		</div>
	)
}

const label = (v: Verdict) => (v === "BUY ON KP INSTEAD" ? "buy on KP" : v.toLowerCase())

function Card({ o, names }: { o: OfferView; names: { shop: (id: string | null) => string; sku: (id: string) => string } }) {
	const claims = o.shownPrevPrice > o.price
	return (
		<li className={`card c-${VERDICT_CLASS[o.verdict]}`}>
			<div className="card-top">
				<div>
					<h3>{names.sku(o.skuId)}</h3>
					<p className="shop">{names.shop(o.shopId)}</p>
				</div>
				<span key={o.verdict} className={`stamp v-${VERDICT_CLASS[o.verdict]}`}>
					{o.verdict === "CHECKING" ? "Checking" : o.verdict}
				</span>
			</div>
			<p className="price">
				<span className="now">{rsd(o.price)}</span>
				{claims && (
					<>
						<s>{rsd(o.shownPrevPrice)}</s>
						{o.claimedPct != null && <span className="claimed">−{o.claimedPct}%</span>}
					</>
				)}
			</p>
			<dl className="facts">
				<div>
					<dt>Real {o.windowDays ?? 30}-day low</dt>
					<dd>{o.realLow != null ? `${rsd(o.realLow)} (${o.realPct! >= 0 ? "−" : "+"}${Math.abs(o.realPct!)}%)` : "checking"}</dd>
				</div>
				<div>
					<dt>KP, sealed</dt>
					<dd>{o.kpSealed != null ? rsd(o.kpSealed) : "none listed"}</dd>
				</div>
				<div>
					<dt>Best other shop</dt>
					<dd>{o.bestPrice != null ? `${rsd(o.bestPrice)}, ${names.shop(o.bestShopId)}` : "only seller"}</dd>
				</div>
			</dl>
			{o.reason && <p className="reason">{o.reason}</p>}
		</li>
	)
}
