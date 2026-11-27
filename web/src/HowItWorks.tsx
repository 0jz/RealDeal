import "./how.css"

type Agent = { name: string; color: string; tag?: string; text: string }
type Item = Agent | { title: string; color: string; shops: { name: string }[]; text: string }
type Group = { label: string; items: Item[] }

const isScouts = (item: Item): item is Extract<Item, { shops: unknown }> => "shops" in item

const GROUPS: Group[] = [
	{ label: "Understand", items: [
		{ name: "QueryAgent", color: "var(--log-query)", text: "Turns your description into search terms and picks the shops that sell that kind of thing." },
	] },
	{ label: "Find", items: [
		{ title: "Shop scouts", color: "var(--log-scout)", shops: [
			{ name: "Tehnomedia" }, { name: "Ananas" }, { name: "Computers (laptops only)" }, { name: "eponuda" }, { name: "Cenoteka" },
		], text: "Read each shop's own search and product pages for the exact price, picture and link. eponuda and Cenoteka are price-comparison sites and are reported as blocked when they challenge the request." },
	] },
	{ label: "Choose", items: [
		{ name: "JudgeAgent", color: "var(--log-judge)", text: "Scores each listing against what you asked for. Shop titles are treated as data, never as instructions." },
		{ name: "VerifyAgent", color: "var(--log-verify)", text: "Re-reads each listing's page before the plan keeps it." },
	] },
	{ label: "Plan", items: [
		{ name: "PurchaseAgent", color: "var(--log-purchase)", tag: "buy", text: "Matches what you want to the catalogue and prices each offer, from your price or a typical price (estimate)." },
		{ name: "ResaleAgent", color: "var(--log-resale)", tag: "sell", text: "Values what you could sell, from the price you give or a labelled catalogue estimate." },
		{ name: "ShopTrustAgent", color: "var(--log-trust)", tag: "risk", text: "Runs the risk checks on every offer: unknown delivery, a warranty below your minimum, or a price suspiciously far below typical." },
		{ name: "StrategyAgent", color: "var(--log-strategy)", tag: "plan", text: "Explains the plan: what to buy now, what to sell first and what to wait on." },
	] },
	{ label: "Guard", items: [
		{ name: "BudgetGuardian", color: "var(--log-guardian)", tag: "guard", text: "Accepts only current findings, recalculates the plan and refuses any step that spends money you don't have yet." },
	] },
]

/** Every agent counts once; each live shop scout counts as one agent (Gigatron and Office Shoes are off, src/scout/shops.ts). */
export const AGENT_COUNT = GROUPS.reduce(
	(total, group) => total + group.items.reduce((n, item) => n + (isScouts(item) ? item.shops.length : 1), 0),
	0,
)

export function HowItWorks() {
	return <section id="how" className="site-section">
		<h2>How it works</h2>
		<p className="muted">Independent agents react to your plan at the same time. Each result updates the plan as soon as it lands; if the plan changed while an agent was working, BudgetGuardian discards the outdated answer.</p>
		{GROUPS.map(group => <div key={group.label} className="how-group">
			<h3 className="how-label">{group.label}</h3>
			<div className="how-cards">{group.items.map(item => isScouts(item)
				? <article key={item.title} className="site-agent">
					<div className="site-agent-top"><span className="site-dot" style={{ background: item.color }} /><b>{item.title}</b></div>
					<ul className="how-chips" aria-label="Shops">{item.shops.map(shop => <li key={shop.name} className="how-chip">{shop.name}</li>)}</ul>
					<p>{item.text}</p>
				</article>
				: <article key={item.name} className="site-agent">
					<div className="site-agent-top"><span className="site-dot" style={{ background: item.color }} /><b>{item.name}</b>{item.tag && <span className="site-tag">{item.tag}</span>}</div>
					<p>{item.text}</p>
				</article>)}</div>
		</div>)}
		<p className="muted how-note">Scan a barcode to name the product for you. Only the digits leave your device.</p>
	</section>
}
