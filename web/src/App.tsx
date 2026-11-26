import { useState, type FormEvent } from "react"
import { useSearch } from "./stream"
import { Timeline } from "./Timeline"
import type {
	Category,
	Condition,
	MatchMethod,
	Pick as PickItem,
	PriceFlag,
	ProductGroup,
	ResultRow,
	SearchMode,
	SearchRequest,
	SearchView,
	SellEstimate,
	SourceStatus,
} from "./types"

const rsd = (n: number) => `${n.toLocaleString("sr-RS")} RSD`
const digitsOf = (s: string) => s.replace(/\D/g, "")
const groupDigits = (d: string) => (d ? Number(d).toLocaleString("sr-RS") : "")

const MODES: { id: SearchMode; label: string; submit: string }[] = [
	{ id: "search", label: "Pretraga", submit: "Traži" },
	{ id: "budget", label: "Budžet", submit: "Nađi za budžet" },
	{ id: "sell", label: "Prodaja", submit: "Proceni cenu" },
]

const CATEGORIES: { id: Category; label: string }[] = [
	{ id: "phone", label: "Telefon" },
	{ id: "laptop", label: "Laptop" },
	{ id: "tablet", label: "Tablet" },
	{ id: "console", label: "Konzola" },
	{ id: "tv", label: "TV" },
	{ id: "headphones", label: "Slušalice" },
	{ id: "gpu", label: "Grafička" },
	{ id: "watch", label: "Sat" },
]

const CONDITION: Record<Condition, string> = { new: "novo", sealed: "zapečaćeno", used: "polovno" }
const METHOD: Record<MatchMethod, string> = { rule: "tačno", fuzzy: "ispravljen pravopis", llm: "AI", none: "" }
const FLAG: Record<PriceFlag, string> = {
	great: "odlična cena",
	good: "dobra",
	fair: "ok",
	high: "skupo",
	suspicious: "sumnjivo jeftino",
}

type Example = { label: string; request: SearchRequest }

const EXAMPLES: Example[] = [
	{ label: "ajfon 15 pro maks", request: { mode: "search", query: "ajfon 15 pro maks" } },
	{ label: "ps5 slim", request: { mode: "search", query: "ps5 slim" } },
	{ label: "Telefon do 60.000 RSD", request: { mode: "budget", query: "telefon", budget: 60000, category: "phone" } },
]

/** A request the form can send, or null when the form is not complete yet. */
function requestFor(mode: SearchMode, query: string, budget: number, category: Category | "", sell: string): SearchRequest | null {
	if (mode === "sell") return sell.trim() ? { mode, query: sell.trim(), origin: "web" } : null
	if (!query.trim()) return null
	if (mode === "search") return { mode, query: query.trim(), origin: "web" }
	return budget > 0 ? { mode, query: query.trim(), budget, category: category || null, origin: "web" } : null
}

export function App() {
	const { view, store, running, error, run } = useSearch()
	const [mode, setMode] = useState<SearchMode>("search")
	const [query, setQuery] = useState("")
	const [amount, setAmount] = useState("")
	const [category, setCategory] = useState<Category | "">("")
	const [sellText, setSellText] = useState("")

	const budget = Number(digitsOf(amount))
	const request = requestFor(mode, query, budget, category, sellText)
	const submitLabel = MODES.find((m) => m.id === mode)!.submit

	const submit = (e: FormEvent) => {
		e.preventDefault()
		if (request) run(request)
	}

	/** Fills the form with an example, so what the user sees matches what ran. */
	const pickExample = (ex: Example) => {
		const r = ex.request
		setMode(r.mode)
		if (r.mode === "sell") setSellText(r.query)
		else {
			setQuery(r.query)
			setAmount(r.budget ? groupDigits(String(r.budget)) : "")
			setCategory(r.category ?? "")
		}
		run(r)
	}

	const showTimeline = view !== null || running

	return (
		<div className="page">
			<header className="masthead">
				<h1>RealDeal</h1>
				<p className="tagline">Pretraga elektronike koja razume kako ljudi pišu oglase.</p>
			</header>

			<section className="finder" aria-label="Pretraga">
				<div className="modes" role="tablist" aria-label="Režim pretrage">
					{MODES.map((m) => (
						<button key={m.id} type="button" role="tab" aria-selected={mode === m.id} onClick={() => setMode(m.id)}>
							{m.label}
						</button>
					))}
				</div>

				<form className="finder-form" onSubmit={submit}>
					{mode === "sell" ? (
						<label className="field">
							<span className="label">Opiši uređaj koji prodaješ</span>
							<textarea rows={3} value={sellText} onChange={(e) => setSellText(e.target.value)} placeholder="iPhone 13 128GB polovan, baterija 86%" />
						</label>
					) : (
						<label className="field">
							<span className="label">Šta tražiš?</span>
							<input
								type="text"
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								placeholder={mode === "budget" ? "telefon, laptop, ps5…" : "npr. ajfon 15 pro maks, ps5 slim"}
								enterKeyHint="search"
								autoComplete="off"
							/>
						</label>
					)}

					{mode === "budget" && (
						<div className="fields">
							<label className="field">
								<span className="label">Budžet</span>
								<span className="amount">
									<input
										type="text"
										inputMode="numeric"
										value={amount}
										onChange={(e) => setAmount(groupDigits(digitsOf(e.target.value)))}
										placeholder="60.000"
									/>
									<span className="unit">RSD</span>
								</span>
							</label>
							<label className="field">
								<span className="label">Kategorija</span>
								<select value={category} onChange={(e) => setCategory(e.target.value as Category | "")}>
									<option value="">Sve kategorije</option>
									{CATEGORIES.map((c) => (
										<option key={c.id} value={c.id}>
											{c.label}
										</option>
									))}
								</select>
							</label>
						</div>
					)}

					<button type="submit" className="primary" disabled={!request}>
						{submitLabel}
					</button>
				</form>

				{!showTimeline && (
					<div className="examples">
						<p className="label">Probaj jedan od primera</p>
						<ul>
							{EXAMPLES.map((ex) => (
								<li key={ex.label}>
									<button type="button" onClick={() => pickExample(ex)}>
										{ex.label}
									</button>
								</li>
							))}
						</ul>
					</div>
				)}
			</section>

			{error && (
				<p className="alert" role="alert">
					{error}
				</p>
			)}

			{view && view.request.mode !== "sell" && <Sources sources={view.sources} />}
			{view && (view.request.mode === "budget" || (view.request.mode === "search" && view.picks.length > 0)) && <Picks view={view} />}

			<main className="results">
				{view?.request.mode === "sell" ? (
					<SellPanel sell={view.sell} running={running} />
				) : (
					<Results view={view} running={running} />
				)}
			</main>

			{showTimeline && (
				<section className="live" aria-label="Tok pretrage">
					<p className="caption">Svi izvori i svi agenti rade u isto vreme. Trake ispod pokazuju šta se dešava u poslednjih šest sekundi.</p>
					<Timeline store={store} />
				</section>
			)}

			{view && (
				<footer className="foot">
					<p>{view.rejected} oglasa odbijeno (maske, delovi, iCloud lock, replike…)</p>
					{view.sources.length > 0 && view.sources.every((s) => !s.live) && <p>Svi podaci su sintetički (demo)</p>}
				</footer>
			)}
		</div>
	)
}

function Sources({ sources }: { sources: SourceStatus[] }) {
	return (
		<ul className="sources" aria-label="Izvori">
			{sources.map((s) => (
				<li key={s.id} className={`src s-${s.state}`}>
					<span className="src-name">{s.name}</span>
					<span className="src-state">
						{s.state === "done" ? `✓ ${s.found} oglasa, str. ${s.pages}` : s.state === "searching" ? "traži…" : "čeka"}
					</span>
					{!s.live && <span className="tag">demo podaci</span>}
				</li>
			))}
		</ul>
	)
}

function Picks({ view }: { view: SearchView }) {
	const budget = view.request.mode === "budget" ? (view.request.budget ?? 0) : null
	const rows = new Map<string, ResultRow>(view.groups.flatMap((g) => g.rows).map((r) => [r.key, r] as const))

	return (
		<section className="picks" aria-labelledby="picks-title">
			<h2 id="picks-title">{budget !== null ? `Najbolje za ${rsd(budget)}` : "Najbolje cene"}</h2>
			{view.picks.length === 0 ? (
				<p className="empty">{view.done ? "Ništa ne staje u ovaj budžet." : "Tražim najbolju kupovinu…"}</p>
			) : (
				<ol className="pick-list">
					{view.picks.slice(0, 3).map((p, i) => (
						<PickRow key={p.key} pick={p} rank={i + 1} row={rows.get(p.key)} showLeftover={budget !== null} />
					))}
				</ol>
			)}
		</section>
	)
}

function PickRow({ pick, rank, row, showLeftover }: { pick: PickItem; rank: number; row: ResultRow | undefined; showLeftover: boolean }) {
	return (
		<li className="pick">
			<span className="pick-rank">{rank}</span>
			<div className="pick-body">
				<h3>{pick.name}</h3>
				<p className="pick-why">{pick.why}</p>
			</div>
			<div className="pick-money">
				<strong>{rsd(pick.total)}</strong>
				{showLeftover && <span className="sub">ostaje {rsd(pick.leftover)}</span>}
				{row && (
					<a href={row.url} target="_blank" rel="noopener noreferrer">
						Otvori ↗
					</a>
				)}
			</div>
		</li>
	)
}

function Results({ view, running }: { view: SearchView | null; running: boolean }) {
	if (!view) return running ? <p className="empty">Pokrećem agente…</p> : null

	const count = view.groups.reduce((n, g) => n + g.rows.length, 0)
	const summary = `${view.groups.length} modela, ${count} oglasa`

	return (
		<>
			<p className="status" aria-live="polite">
				{view.done ? summary : `Još traži… ${summary} do sada`}
			</p>
			{view.groups.length === 0 ? (
				<p className="empty">{view.done ? "Nismo našli oglase za ovaj upit." : "Tražim oglase…"}</p>
			) : (
				<ul className="groups">
					{view.groups.map((g) => (
						<GroupCard key={g.productId} group={g} />
					))}
				</ul>
			)}
		</>
	)
}

function GroupCard({ group }: { group: ProductGroup }) {
	return (
		<li className="group">
			<div className="group-head">
				<h3>{group.name}</h3>
				<p className="group-prices">
					<span>
						od <strong>{rsd(group.low)}</strong>
					</span>
					{group.market !== null && (
						<span>
							tržišna <strong>{rsd(group.market)}</strong>
						</span>
					)}
				</p>
			</div>
			<ul className="rows">
				<li className="rows-head" aria-hidden="true">
					<span>Izvor</span>
					<span>Naslov, kako ga piše prodavac</span>
					<span>Cena</span>
					<span>Stanje, mesto</span>
					<span>Procena</span>
					<span />
				</li>
				{group.rows.map((r, i) => (
					<RowItem key={r.key} row={r} index={i} />
				))}
			</ul>
		</li>
	)
}

function RowItem({ row, index }: { row: ResultRow; index: number }) {
	const ship = row.shipping === null ? "dostava nepoznata" : row.shipping === 0 ? "dostava besplatna" : `+ ${rsd(row.shipping)} dostava`

	return (
		<li className="row" style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}>
			<span className="r-src">
				<strong>{row.sourceName}</strong>
				{row.shopName && <span className="sub">{row.shopName}</span>}
				{row.shopTrust != null && <span className="sub">poverenje {row.shopTrust}</span>}
			</span>
			<span className="r-title">
				“{row.title}”{row.why && <span className="why">{row.why}</span>}
			</span>
			<span className="r-price">
				<strong>{rsd(row.price)}</strong>
				<span className="sub">{ship}</span>
			</span>
			<span className="r-meta">
				{row.condition && <span>{CONDITION[row.condition]}</span>}
				{row.city && <span className="sub">{row.city}</span>}
			</span>
			<span className="r-badges">
				{row.method !== "none" && <span className={`badge m-${row.method}`}>{METHOD[row.method]}</span>}
				<span className="conf">{Math.round(row.confidence * 100)}%</span>
				{row.flag && <span className={`flag f-${row.flag}`}>{FLAG[row.flag]}</span>}
				{row.thirtyDay && !row.thirtyDay.legal && (
					<span className="badge fake" title={`Najniža cena u poslednjih 30 dana: ${rsd(row.thirtyDay.realLow)}`}>
						lažni popust
					</span>
				)}
			</span>
			<a className="r-link" href={row.url} target="_blank" rel="noopener noreferrer">
				Otvori ↗
			</a>
		</li>
	)
}

function SellPanel({ sell, running }: { sell: SellEstimate | null; running: boolean }) {
	if (!sell) return running ? <p className="empty">Procenjujem cenu…</p> : null

	const facts = [CONDITION[sell.condition], sell.storageGb ? `${sell.storageGb} GB` : null].filter(Boolean).join(" · ")

	return (
		<section className="sell" aria-label="Procena prodaje">
			<div className="sell-head">
				<div>
					<h2>{sell.name ?? "Model nije prepoznat"}</h2>
					<p className="sub">{facts}</p>
				</div>
				<dl className="sell-prices">
					<div>
						<dt>Brza prodaja</dt>
						<dd>{sell.quick !== null ? rsd(sell.quick) : "—"}</dd>
					</div>
					<div>
						<dt>Strpljivo</dt>
						<dd>{sell.patient !== null ? rsd(sell.patient) : "—"}</dd>
					</div>
				</dl>
			</div>
			<p className="note">{sell.note}</p>

			{sell.comps.length > 0 && (
				<div className="block">
					<h3 className="section-title">Slični oglasi</h3>
					<ul className="comps">
						{sell.comps.map((c) => (
							<li key={c.key}>
								<span>“{c.title}”</span>
								<strong>{rsd(c.price)}</strong>
								<a href={c.url} target="_blank" rel="noopener noreferrer">
									Otvori ↗
								</a>
							</li>
						))}
					</ul>
				</div>
			)}

			{sell.draft && <Draft title={sell.draft.title} description={sell.draft.description} />}
		</section>
	)
}

function Draft({ title, description }: { title: string; description: string }) {
	const [copy, setCopy] = useState<"idle" | "ok" | "fail">("idle")

	const onCopy = async () => {
		try {
			await navigator.clipboard.writeText(`${title}\n\n${description}`)
			setCopy("ok")
		} catch {
			setCopy("fail")
		}
		setTimeout(() => setCopy("idle"), 1600)
	}

	return (
		<div className="block draft">
			<div className="draft-head">
				<h3 className="section-title">Nacrt oglasa</h3>
				<button type="button" className="ghost" onClick={onCopy}>
					{copy === "ok" ? "Kopirano" : copy === "fail" ? "Nije uspelo" : "Kopiraj"}
				</button>
			</div>
			<p className="draft-title">{title}</p>
			<p className="draft-body">{description}</p>
		</div>
	)
}
