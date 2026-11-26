// Pure text for the Telegram bot: command parsing and Telegram HTML rendering.
// No search logic here; everything comes from SearchView / ResultRow.

import { CATEGORY_WORDS } from "../search/catalogue"
import type { Category, PriceFlag, ResultRow, SearchRequest, SearchView } from "../search/types"

const MAX_CHARS = 3800
const MAX_QUERY = 200
const MIN_BUDGET = 1000
const MAX_BUDGET = 100_000_000

export const CATEGORY_LABEL: Record<Category, string> = {
	phone: "telefon",
	laptop: "laptop",
	tablet: "tablet",
	console: "konzola",
	tv: "televizor",
	headphones: "slušalice",
	gpu: "grafička karta",
	watch: "pametni sat",
}

const CONDITION_LABEL = { new: "novo", sealed: "zapečaćeno", used: "polovno" } as const

const FLAG: Record<PriceFlag, { icon: string; text: string }> = {
	great: { icon: "🔥", text: "odlična cena" },
	good: { icon: "✅", text: "dobra cena" },
	fair: { icon: "•", text: "fer cena" },
	high: { icon: "⬆️", text: "skuplje od tržišta" },
	suspicious: { icon: "⚠️", text: "sumnjivo jeftino" },
}

// ---- helpers ----

/** Escapes text for Telegram HTML parse mode. */
export function esc(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function escAttr(text: string): string {
	return esc(text).replace(/"/g, "&quot;")
}

/** 84500 -> "84.500 RSD" */
export function formatPrice(rsd: number): string {
	return `${Math.round(rsd).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")} RSD`
}

function normalize(text: string): string {
	return text
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/đ/gi, "dj")
		.toLowerCase()
		.trim()
}

function truncate(text: string, max: number): string {
	const clean = text.replace(/\s+/g, " ").trim()
	return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function safeHref(url: string): string | null {
	return /^https?:\/\//i.test(url) ? escAttr(url) : null
}

function link(text: string, url: string): string {
	const href = safeHref(url)
	return href ? `<a href="${href}">${esc(text)}</a>` : esc(text)
}

// ---- command parsing ----

/** Serbian category phrase (normalized) -> category. Covers multi-word phrases such as "graficka karta". */
const CATEGORY_PHRASES = new Map<string, Category>()
for (const [category, words] of Object.entries(CATEGORY_WORDS) as Array<[Category, string[]]>) {
	for (const word of words) CATEGORY_PHRASES.set(normalize(word), category)
}

/** Parses "100000", "100.000", "100,000", "100k", "100 hiljada" into RSD. Null when it is not an amount. */
function parseAmount(number: string, suffix?: string): number | null {
	let value: number
	if (suffix) {
		value = Number(number.replace(",", ".")) * 1000
	} else if (/^\d{1,3}([.,]\d{3})+$/.test(number)) {
		value = Number(number.replace(/[.,]/g, ""))
	} else if (/^\d+$/.test(number)) {
		value = Number(number)
	} else {
		return null
	}
	if (!Number.isFinite(value)) return null
	const rounded = Math.round(value)
	return rounded >= MIN_BUDGET && rounded <= MAX_BUDGET ? rounded : null
}

/** Splits "100k telefon iphone" into the leading amount and the rest. */
function splitLeadingAmount(args: string): { amount: number | null; rest: string } | null {
	const match = /^(\d[\d.,]*)(?:\s*(k|hiljad[a-z]*))?(?=\s|$)/i.exec(args)
	if (!match) return null
	return { amount: parseAmount(match[1], match[2]), rest: args.slice(match[0].length).trim() }
}

/** Splits "iphone 15 pro 80k" into the query and the trailing amount (for /prati). */
export function splitTrailingAmount(args: string): { query: string; amount: number | null } | null {
	const match = /^(.*?)\s*(\d[\d.,]*)(?:\s*(k|hiljad[a-z]*))?$/i.exec(args.trim())
	if (!match || !match[1].trim()) return null
	return { query: match[1].trim(), amount: parseAmount(match[2], match[3]) }
}

function cleanQuery(text: string): string {
	return text.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY)
}

/** Takes a leading category phrase off the words, if there is one. */
function takeCategory(words: string): { category: Category | null; rest: string } {
	const tokens = words.split(/\s+/).filter(Boolean)
	for (let n = Math.min(3, tokens.length); n >= 1; n--) {
		const category = CATEGORY_PHRASES.get(normalize(tokens.slice(0, n).join(" ")))
		if (category) return { category, rest: tokens.slice(n).join(" ") }
	}
	return { category: null, rest: words }
}

/**
 * Parses one chat message into a search request.
 * Returns null for /start, /help and empty text, { error } for a bad or unknown command.
 * Plain text without a command is a /trazi search.
 */
export function parseCommand(text: string): SearchRequest | { error: string } | null {
	const trimmed = text.trim()
	if (!trimmed) return null
	if (!trimmed.startsWith("/")) {
		return { mode: "search", query: cleanQuery(trimmed), origin: "telegram" }
	}

	const [head, ...tail] = trimmed.split(/\s+/)
	const command = head.slice(1).split("@")[0].toLowerCase()
	const args = tail.join(" ")

	switch (command) {
		case "start":
		case "help":
			return null
		case "trazi": {
			const query = cleanQuery(args)
			if (!query) return { error: "Upiši šta tražiš, npr. /trazi iphone 15 pro" }
			return { mode: "search", query, origin: "telegram" }
		}
		case "budzet": {
			const leading = splitLeadingAmount(args)
			if (!leading) return { error: "Upiši iznos, npr. /budzet 100k telefon" }
			if (leading.amount === null) {
				return { error: `Iznos mora biti između ${formatPrice(MIN_BUDGET)} i ${formatPrice(MAX_BUDGET)}.` }
			}
			const { category, rest } = takeCategory(leading.rest)
			const query = cleanQuery(rest)
			if (!category && !query) return { error: "Dodaj kategoriju ili upit, npr. /budzet 100k telefon" }
			return { mode: "budget", query, budget: leading.amount, category, origin: "telegram" }
		}
		case "prodaj": {
			const query = cleanQuery(args)
			if (!query) return { error: "Opiši uređaj, npr. /prodaj iphone 13 128GB polovan baterija 86%" }
			return { mode: "sell", query, origin: "telegram" }
		}
		default:
			return { error: "Ne znam tu komandu. Pošalji /help za spisak." }
	}
}

// ---- rendering ----

function sourcesLine(view: SearchView): string {
	return view.sources
		.map((s) => {
			if (s.state === "done") return `${esc(s.name)} ✓ ${s.pages} str`
			if (s.state === "searching") return `${esc(s.name)} … traži`
			return `${esc(s.name)} čeka`
		})
		.join(" · ")
}

function headerLine(view: SearchView): string {
	const { request } = view
	if (request.mode === "budget") {
		const parts = [`💰 <b>Budžet ${formatPrice(request.budget ?? 0)}</b>`]
		if (request.category) parts.push(CATEGORY_LABEL[request.category])
		if (request.query) parts.push(esc(request.query))
		return parts.join(" · ")
	}
	if (request.mode === "sell") return `🏷 <b>Prodaja: ${esc(request.query)}</b>`
	return `🔎 <b>${esc(request.query)}</b>`
}

function rowLine(row: ResultRow): string {
	const parts: string[] = []
	const flag = row.flag ? FLAG[row.flag] : null
	if (flag) parts.push(`${flag.icon} ${flag.text}`)
	if (row.thirtyDay && !row.thirtyDay.legal) parts.push("❌ lažni popust")
	const price = row.shipping && row.shipping > 0 ? `${formatPrice(row.total)} sa dostavom` : formatPrice(row.total)
	const place = row.shopName ?? row.city ?? row.sourceName
	const cond = row.condition ? CONDITION_LABEL[row.condition] : null
	const meta = [`<b>${esc(price)}</b>`, cond, esc(place)].filter(Boolean).join(" · ")
	const title = link(truncate(row.title, 40), row.url)
	return `${parts.length ? `${parts.join(" ")} ` : ""}${meta} · ${title}`
}

function pickBlock(view: SearchView): string[] {
	const { request, picks } = view
	const budget = request.mode === "budget"
	if (picks.length === 0) {
		if (!budget) return []
		return [view.done ? "Nijedan oglas se ne uklapa u budžet." : "Tražim predloge…"]
	}
	const rows = new Map(view.groups.flatMap((g) => g.rows).map((r) => [r.key, r] as const))
	const lines = [budget ? `<b>Najbolje za ${formatPrice(request.budget ?? 0)}:</b>` : "<b>Najbolje cene:</b>"]
	picks.slice(0, 3).forEach((pick, i) => {
		const row = rows.get(pick.key)
		const name = row ? link(pick.name, row.url) : esc(pick.name)
		const leftover = budget ? ` · ostaje ${formatPrice(pick.leftover)}` : ""
		lines.push(`${i + 1}. <b>${name}</b> — ${formatPrice(pick.total)}${leftover}`)
		lines.push(`   <i>${esc(pick.why)}</i>`)
	})
	return [lines.join("\n")]
}

function groupBlock(group: { name: string; low: number; market: number | null; rows: ResultRow[] }): string {
	const market = group.market ? ` · tržište ~${formatPrice(group.market)}` : ""
	const lines = [`<b>${esc(group.name)}</b> — od ${formatPrice(group.low)}${market}`]
	for (const row of group.rows.slice(0, 3)) lines.push(rowLine(row))
	return lines.join("\n")
}

function sellBlock(view: SearchView): string[] {
	const sell = view.sell
	if (!sell) return [view.done ? "Nemam dovoljno oglasa za procenu." : "Procenjujem cenu…"]

	const details = [sell.condition ? CONDITION_LABEL[sell.condition] : null, sell.storageGb ? `${sell.storageGb} GB` : null]
	const name = `<b>${esc(sell.name ?? view.request.query)}</b>`
	const title = details.some(Boolean) ? `${name} · ${esc(details.filter(Boolean).join(", "))}` : name

	const quick = sell.quick ? formatPrice(sell.quick) : "—"
	const patient = sell.patient ? formatPrice(sell.patient) : "—"
	const lines = [
		title,
		`Brza prodaja: <b>${quick}</b> · Strpljiv: <b>${patient}</b>`,
		`Upoređeno sa ${sell.comps.length} oglasa.`,
	]
	if (sell.draft) {
		lines.push(`Naslov: <code>${esc(truncate(sell.draft.title, 120))}</code>`)
		lines.push(`Opis:\n<pre>${esc(truncate(sell.draft.description, 800))}</pre>`)
	}
	if (sell.note) lines.push(`<i>${esc(sell.note)}</i>`)
	return [lines.join("\n")]
}

function footerLines(view: SearchView): string[] {
	const lines = [
		view.done
			? `<i>gotovo · ${view.rejected} oglasa odbijeno (maske, delovi, iCloud…)</i>`
			: "<i>još traži…</i>",
	]
	if (view.sources.length > 0 && view.sources.every((s) => s.live === false)) {
		lines.push("<i>Podaci su sintetički (demo).</i>")
	}
	return lines
}

/** Renders a view as Telegram HTML, at most 3800 characters. */
export function formatView(view: SearchView): string {
	const head = [headerLine(view), `<i>${sourcesLine(view)}</i>`].join("\n")

	let blocks: string[]
	if (view.request.mode === "sell") {
		blocks = sellBlock(view)
	} else {
		blocks = pickBlock(view)
		blocks.push(...view.groups.slice(0, 5).map(groupBlock))
	}

	const footer = footerLines(view).join("\n")
	const budget = MAX_CHARS - head.length - footer.length - 60
	let body = ""
	let omitted = 0
	blocks.forEach((block, i) => {
		const next = body ? `${body}\n\n${block}` : block
		if (next.length <= budget) body = next
		else omitted = blocks.length - i
	})

	const parts = [head]
	if (body) parts.push(body)
	if (omitted > 0) parts.push(`<i>… još ${omitted} u pretrazi na sajtu</i>`)
	parts.push(footer)
	return parts.join("\n\n").slice(0, MAX_CHARS)
}

/** Message for a /prati alert: listings that just came under the watched price. */
export function formatWatchAlert(query: string, maxPrice: number, rows: ResultRow[]): string {
	const lines = [`🔔 Novo ispod ${formatPrice(maxPrice)} za <b>${esc(query)}</b>:`]
	for (const row of rows.slice(0, 10)) lines.push(rowLine(row))
	return lines.join("\n")
}

export function helpText(): string {
	return [
		"<b>RealDeal</b> traži elektroniku po oglasima i prodavnicama u Srbiji.",
		"",
		"<b>/trazi &lt;upit&gt;</b> — pretraga, npr. <code>/trazi iphone 15 pro 256</code>",
		"<b>/budzet &lt;iznos&gt; &lt;kategorija ili upit&gt;</b> — šta kupiti za budžet, npr. <code>/budzet 100k telefon</code> ili <code>/budzet 80.000 sony xm5</code>",
		"<b>/prodaj &lt;opis&gt;</b> — koliko vredi tvoj uređaj, npr. <code>/prodaj iphone 13 128GB polovan baterija 86%</code>",
		"<b>/prati &lt;upit&gt; &lt;max cena&gt;</b> — javim kad se pojavi oglas ispod cene, npr. <code>/prati ps5 60000</code>",
		"<b>/prati</b> — lista praćenja · <b>/stop</b> — prekini sva praćenja",
		"",
		"Pošalji samo naziv uređaja bez komande i to je pretraga.",
	].join("\n")
}
