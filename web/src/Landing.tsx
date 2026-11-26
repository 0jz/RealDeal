import { useEffect, useState, type ReactNode } from "react"
import type { Goal } from "../../src/finance/types"
import { rsd } from "./Finance"

/** Layout and look follow Nikita's landing page on the `site` branch (public/index.html, site.css). */

/** Dark top bar. `links` shows the in-page links (landing only); `action` sits on the right. */
export function SiteNav({ links = false, action }: { links?: boolean; action?: ReactNode }) {
	return <header className="site-nav">
		<a className="site-brand" href="/"><span className="site-logo" aria-hidden="true">R</span><span>RealDeal</span></a>
		{links && <nav aria-label="Sections"><a href="#how">How it works</a><a href="/new">Make a plan</a></nav>}
		{action && <div className="site-nav-action">{action}</div>}
	</header>
}

/** The same roles as the README's participant table. */
const AGENTS = [
	{ name: "PurchaseAgent", color: "var(--lane-eponuda)", tag: "buy", text: "Matches what you want to the catalogue and prices each offer, from your price or a typical price (estimate)." },
	{ name: "ResaleAgent", color: "var(--lane-sell)", tag: "sell", text: "Values what you could sell, from the price you give or a labelled catalogue estimate." },
	{ name: "ShopTrustAgent", color: "var(--lane-match)", tag: "risk", text: "Runs the risk checks on every offer: unknown delivery, a warranty below your minimum, or a price suspiciously far below typical." },
	{ name: "StrategyAgent", color: "var(--lane-rank)", tag: "plan", text: "Explains the plan: what to buy now, what to sell first and what to wait on." },
	{ name: "BudgetGuardian", color: "var(--lane-kp)", tag: "guard", text: "Accepts only current findings, recalculates the plan and refuses any step that spends money you don't have yet." },
]

/** Figures for the hero, read from the example plan on the server. Nothing is computed by an agent here, so the labels say "example". */
function exampleTiles(g: Goal) {
	const want = g.wishes.reduce((n, w) => n + w.price + (w.delivery ?? 0), 0)
	const sale = g.assets.reduce((n, a) => n + (a.expectedPrice ?? 0) - a.fee - a.delivery, 0)
	return [
		{ value: rsd(g.cash), label: "cash in hand" },
		{ value: rsd(want), label: `for ${g.wishes.map(w => w.name).join(" and ")}, delivery included` },
		{ value: `+${rsd(sale)}`, label: `from selling the ${g.assets.map(a => a.name).join(" and ")}, after fees`, tone: "green" },
		{ value: `${g.deadlineDays}`, unit: "days", label: "to get it done" },
	]
}

/** The front page. "Make my plan" opens the prompt page at /new. */
export function Landing() {
	const [example, setExample] = useState<Goal | null>(null)
	useEffect(() => {
		const ctl = new AbortController()
		fetch("/api/goal/example", { signal: ctl.signal }).then(r => r.ok ? r.json() : null).then(setExample).catch(() => {})
		return () => ctl.abort()
	}, [])

	return <div className="site">
		<SiteNav links />
		<div className="site-notice" role="note"><b>Not financial advice.</b> RealDeal plans with the prices you type. Missing prices are filled with a typical price from a small catalogue and always labelled as an estimate. It never buys, sells or holds money for you.</div>

		<section className="site-hero">
			<div className="site-hero-inner">
				<p className="site-eyebrow">Buy · sell · stay within budget</p>
				<h1>Can you <em>afford</em> it?</h1>
				<p className="site-lead">Say what you want to buy and what you could sell. Five agents check your offers, value your old things, flag risky deals and build <b>one plan that never spends money you don't have yet</b>: what to buy now, what to sell first and what to wait on.</p>
				<div className="site-cta"><a className="site-btn primary" href="/new">Make my plan</a><a className="site-btn" href="#how">How it works</a></div>
				{example && <>
					<div className="site-stats">{exampleTiles(example).map(t => <div key={t.label} className="site-stat">
						<div className={t.tone === "green" ? "site-stat-v green" : "site-stat-v"}>{t.value}{t.unit && <span> {t.unit}</span>}</div>
						<div className="site-stat-l">{t.label}</div>
					</div>)}</div>
					<p className="site-hero-foot">Example plan “{example.title}”, read from the server. Make your own plan and the agents check it live.</p>
				</>}
			</div>
		</section>

		<main className="site-wrap">
			<section id="how" className="site-section">
				<h2>How it works</h2>
				<p className="muted">Independent agents react to your plan at the same time. Each result updates the plan as soon as it lands; if the plan changed while an agent was working, BudgetGuardian discards the outdated answer.</p>
				<div className="site-agents">{AGENTS.map(a => <article key={a.name} className="site-agent">
					<div className="site-agent-top"><span className="site-dot" style={{ background: a.color }} /><b>{a.name}</b><span className="site-tag">{a.tag}</span></div>
					<p>{a.text}</p>
				</article>)}</div>
			</section>
		</main>

		<footer className="site-footer site-wrap">
			<p><b>Not financial advice.</b> Every price is labelled “your price” or “typical price (estimate)”. No shops, links or delivery costs are invented.</p>
			<p>Built on <a href="https://www.npmjs.com/package/@mozaik-ai/core" target="_blank" rel="noopener">@mozaik-ai/core</a>.</p>
		</footer>
	</div>
}
