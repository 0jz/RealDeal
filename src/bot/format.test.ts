import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { formatView, helpText, parseCommand } from "./format"
import type { Pick, ProductGroup, ResultRow, SearchRequest, SearchView, SourceStatus } from "../search/types"

function row(overrides: Partial<ResultRow> = {}): ResultRow {
	return {
		key: "kp|1",
		source: "kp",
		sourceName: "KupujemProdajem",
		image: null,
		kind: "classified",
		title: "iPhone 15 Pro 256GB",
		url: "https://example.com/oglas/1",
		price: 84500,
		shipping: null,
		total: 84500,
		condition: "used",
		city: "Beograd",
		shopName: null,
		storageGb: 256,
		productId: "iphone-15-pro",
		confidence: 0.95,
		method: "rule",
		market: 92000,
		flag: "great",
		thirtyDay: null,
		shopTrust: null,
		score: 80,
		why: "",
		...overrides,
	}
}

function group(i: number, rows: ResultRow[] = [row({ key: `kp|g${i}a` }), row({ key: `kp|g${i}b`, total: 90000 }), row({ key: `kp|g${i}c`, total: 95000 }), row({ key: `kp|g${i}d`, total: 99000 })]): ProductGroup {
	return {
		productId: `p-${i}`,
		name: `Uređaj ${i} 256GB`,
		category: "phone",
		low: rows[0].total,
		market: 92000,
		rows,
	}
}

const sources: SourceStatus[] = [
	{ id: "kp", name: "KupujemProdajem", live: false, state: "done", pages: 3, found: 40 },
	{ id: "eponuda", name: "eponuda", live: false, state: "searching", pages: 1, found: 5 },
]

function view(request: SearchRequest, overrides: Partial<SearchView> = {}): SearchView {
	return {
		id: "s1",
		request,
		startedAt: 0,
		terms: ["iphone 15 pro"],
		sources,
		groups: [group(1)],
		picks: [],
		rejected: 12,
		sell: null,
		done: false,
		...overrides,
	}
}

describe("parseCommand", () => {
	test("/trazi takes the rest as the query", () => {
		assert.deepEqual(parseCommand("/trazi iphone 15 pro"), { mode: "search", query: "iphone 15 pro", origin: "telegram" })
	})

	test("plain text is a search", () => {
		assert.deepEqual(parseCommand("  iphone 15  "), { mode: "search", query: "iphone 15", origin: "telegram" })
	})

	test("command with bot username suffix", () => {
		assert.deepEqual(parseCommand("/trazi@RealDealBot iphone"), { mode: "search", query: "iphone", origin: "telegram" })
	})

	test("/start and /help return null", () => {
		assert.equal(parseCommand("/start"), null)
		assert.equal(parseCommand("/help"), null)
		assert.equal(parseCommand(""), null)
	})

	test("/trazi without a query is an error", () => {
		assert.ok("error" in (parseCommand("/trazi") ?? {}))
	})

	test("unknown command is an error", () => {
		assert.ok("error" in (parseCommand("/nepoznato x") ?? {}))
	})

	test("budget amount formats", () => {
		const amounts = ["100000", "100.000", "100,000", "100k", "100 hiljada", "100 HILJADA"]
		for (const a of amounts) {
			const result = parseCommand(`/budzet ${a} laptop`)
			assert.ok(result && !("error" in result), `${a} should parse`)
			assert.equal(result.mode, "budget")
			assert.equal(result.budget, 100000, a)
			assert.equal(result.category, "laptop", a)
		}
	})

	test("budget category word maps to category with no query", () => {
		assert.deepEqual(parseCommand("/budzet 100k telefon"), {
			mode: "budget",
			query: "",
			budget: 100000,
			category: "phone",
			origin: "telegram",
		})
	})

	test("budget category word with a model keeps the rest as query", () => {
		const result = parseCommand("/budzet 100k telefon iphone 15")
		assert.ok(result && !("error" in result))
		assert.equal(result.category, "phone")
		assert.equal(result.query, "iphone 15")
	})

	test("multi-word category and diacritics", () => {
		const result = parseCommand("/budzet 80k slušalice")
		assert.ok(result && !("error" in result))
		assert.equal(result.category, "headphones")
		assert.equal(result.budget, 80000)
		const gpu = parseCommand("/budzet 60000 grafička karta")
		assert.ok(gpu && !("error" in gpu))
		assert.equal(gpu.category, "gpu")
	})

	test("budget with a non-category rest is a query", () => {
		const result = parseCommand("/budzet 80.000 sony xm5")
		assert.ok(result && !("error" in result))
		assert.equal(result.category, null)
		assert.equal(result.query, "sony xm5")
	})

	test("budget errors", () => {
		assert.ok("error" in (parseCommand("/budzet") ?? {}))
		assert.ok("error" in (parseCommand("/budzet telefon") ?? {}))
		assert.ok("error" in (parseCommand("/budzet 100k") ?? {}))
		assert.ok("error" in (parseCommand("/budzet 5 telefon") ?? {}))
	})

	test("/prodaj is a sell request", () => {
		assert.deepEqual(parseCommand("/prodaj iphone 13 128GB polovan"), {
			mode: "sell",
			query: "iphone 13 128GB polovan",
			origin: "telegram",
		})
	})

	test("help text lists the commands", () => {
		const text = helpText()
		for (const cmd of ["/trazi", "/budzet", "/prodaj", "/prati", "/stop"]) assert.ok(text.includes(cmd), cmd)
	})
})

describe("formatView", () => {
	test("search mode shows header, sources, price, link and open footer", () => {
		const text = formatView(view({ mode: "search", query: "iphone 15 pro" }))
		assert.ok(text.includes("iphone 15 pro"))
		assert.ok(text.includes("KupujemProdajem ✓ 3 str"))
		assert.ok(text.includes("eponuda … traži"))
		assert.ok(text.includes("84.500 RSD"))
		assert.ok(text.includes('<a href="https://example.com/oglas/1">'))
		assert.ok(text.includes("odlična cena"))
		assert.ok(text.includes("još traži…"))
	})

	test("done view shows the rejected count footer", () => {
		const sourcesDone = sources.map((s) => ({ ...s, state: "done" as const }))
		const text = formatView(view({ mode: "search", query: "x" }, { done: true, sources: sourcesDone }))
		assert.ok(text.includes("gotovo · 12 oglasa odbijeno"))
	})

	test("budget mode shows picks with total and leftover before groups", () => {
		const picks: Pick[] = [
			{ key: "kp|g1a", productId: "p-1", name: "Uređaj 1 256GB", total: 84500, leftover: 15500, why: "najbolja cena za model" },
			{ key: "kp|g1b", productId: "p-1", name: "Uređaj 1 128GB", total: 70000, leftover: 30000, why: "jeftiniji" },
		]
		const text = formatView(
			view({ mode: "budget", query: "", budget: 100000, category: "phone" }, { picks, done: true }),
		)
		assert.ok(text.includes("Najbolje za 100.000 RSD:"))
		assert.ok(text.indexOf("Najbolje za") < text.indexOf("Uređaj 1 256GB"))
		assert.ok(text.includes("ostaje 15.500 RSD"))
		assert.ok(text.includes("najbolja cena za model"))
	})

	test("sell mode shows range, comps count and escaped draft", () => {
		const text = formatView(
			view(
				{ mode: "sell", query: "iphone 13 128GB" },
				{
					done: true,
					sell: {
						productId: "iphone-13",
						name: "iPhone 13",
						condition: "used",
						storageGb: 128,
						quick: 38000,
						patient: 44000,
						comps: [
							{ key: "kp|1", title: "a", price: 40000, url: "https://example.com/1" },
							{ key: "kp|2", title: "b", price: 42000, url: "https://example.com/2" },
						],
						draft: { title: "iPhone 13 128GB polovan <odlično>", description: "Baterija 86%.\nBez oštećenja." },
						note: "Procena na osnovu 2 oglasa.",
					},
				},
			),
		)
		assert.ok(text.includes("Brza prodaja: <b>38.000 RSD</b> · Strpljiv: <b>44.000 RSD</b>"))
		assert.ok(text.includes("Upoređeno sa 2 oglasa."))
		assert.ok(text.includes("<code>iPhone 13 128GB polovan &lt;odlično&gt;</code>"))
		assert.ok(text.includes("<pre>Baterija 86%."))
	})

	test("escapes HTML in titles", () => {
		const evil = group(1, [row({ title: "<script>alert(1)</script>", key: "kp|x" })])
		const text = formatView(view({ mode: "search", query: "x" }, { groups: [evil] }))
		assert.ok(text.includes("&lt;script&gt;alert(1)&lt;/script&gt;"))
		assert.ok(!text.includes("<script>"))
	})

	test("escapes HTML in the query", () => {
		const text = formatView(view({ mode: "search", query: "<b>x</b> & y" }))
		assert.ok(text.includes("&lt;b&gt;x&lt;/b&gt; &amp; y"))
	})

	test("never exceeds 3800 characters with 50 groups", () => {
		const groups = Array.from({ length: 50 }, (_, i) => group(i))
		const text = formatView(view({ mode: "search", query: "telefon" }, { groups, done: true }))
		assert.ok(text.length <= 3800, `length ${text.length}`)
		assert.ok(text.includes("gotovo"))
	})

	test("shows the synthetic-data footer when every source is fixture-based", () => {
		const text = formatView(view({ mode: "search", query: "x" }))
		assert.ok(text.includes("Podaci su sintetički (demo)."))
	})

	test("no synthetic footer when a source is live", () => {
		const mixed = sources.map((s, i) => (i === 0 ? { ...s, live: true } : s))
		const text = formatView(view({ mode: "search", query: "x" }, { sources: mixed }))
		assert.ok(!text.includes("sintetički"))
	})
})
