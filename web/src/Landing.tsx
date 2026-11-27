import type { MouseEvent, ReactNode } from "react"
import { AGENT_COUNT, HowItWorks } from "./HowItWorks"

/** Layout and look follow Nikita's landing page on the `site` branch (public/index.html, site.css). */

/** Scrolls the prompt in the hero into view and focuses it. Also used by /new, which now opens the front page. */
export function focusAsk(e?: MouseEvent<HTMLAnchorElement>) {
	e?.preventDefault()
	const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches
	document.getElementById("ask")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })
	document.getElementById("ask-input")?.focus({ preventScroll: true })
}

/** Dark top bar. `links` shows the in-page links (landing only); `action` sits on the right. */
export function SiteNav({ links = false, action }: { links?: boolean; action?: ReactNode }) {
	return <header className="site-nav">
		<a className="site-brand" href="/"><span className="site-logo" aria-hidden="true">R</span><span>RealDeal</span></a>
		{links && <nav aria-label="Sections"><a href="#how">How it works</a><a href="#ask" onClick={focusAsk}>Make a plan</a></nav>}
		{action && <div className="site-nav-action">{action}</div>}
	</header>
}

/** The front page. The prompt (passed as `ask`) sits in the hero where the old buttons were. */
export function Landing({ ask }: { ask: ReactNode }) {
	return <div className="site">
		<SiteNav links />
		<div className="site-notice" role="note"><b>Not financial advice.</b> RealDeal plans with the prices you type. Missing prices are filled with a typical price from a small catalogue and always labelled as an estimate. It never buys, sells or holds money for you.</div>

		<section className="site-hero">
			<div className="site-hero-inner">
				<p className="site-eyebrow">Stay within budget</p>
				<h1>Can you <em>afford</em> it?</h1>
				<p className="site-lead">Say what you want to buy and what you could sell. {AGENT_COUNT} agents find live shop prices, check your offers, value your old things, flag risky deals and build <b>one plan that never spends money you don't have yet</b>: what to buy now, what to sell first and what to wait on.</p>
					<a className="hero-how" href="#how">How does it work? See the {AGENT_COUNT} agents ↓</a>
				{ask}
			</div>
		</section>

		<main className="site-wrap">
			<HowItWorks />
		</main>

		<footer className="site-footer site-wrap">
			<p><b>Not financial advice.</b> Every price is labelled “your price” or “typical price (estimate)”. No shops, links or delivery costs are invented.</p>
			<p>Built on <a href="https://www.npmjs.com/package/@mozaik-ai/core" target="_blank" rel="noopener">@mozaik-ai/core</a>.</p>
		</footer>
	</div>
}
