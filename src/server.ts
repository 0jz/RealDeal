import "dotenv/config"
import { createReadStream, existsSync } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { extname, join, normalize } from "node:path"
import { resolveRuntime, type LogEntry } from "./runtime"
import { cancel, search, startEngine, subscribe } from "./search/engine"
import type { Category, SearchMode, SearchRequest } from "./search/types"
import { commandGoal, createGoal, createGoalFromPrompt, EXAMPLE_GOAL, getGoal, PromptError, subscribeGoal } from "./finance/engine"
import { CATALOGUE } from "./search/catalogue"
import type { CommandRequest } from "./finance/types"
import { normalizeBarcode } from "./barcode/code"
import { lookupBarcode } from "./barcode/lookup"

// One process: the Mozaik search swarm, a small JSON API, an SSE stream per
// search, and the UI (Vite middleware in dev, the built files with --prod).

const PORT = Number(process.env.PORT ?? 8787)
const PROD = process.argv.includes("--prod")
/** Each search pages every source, so cap how many run at once. */
const MAX_RUNNING = 20

const state = startEngine()

function send(res: ServerResponse, event: string, data: unknown) {
	res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

const json = (res: ServerResponse, status: number, body: unknown): void => void res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body))

async function readBody(req: IncomingMessage): Promise<unknown> {
	let size = 0
	const chunks: Buffer[] = []
	for await (const c of req) {
		size += (c as Buffer).length
		if (size > 10_000) throw new Error("body too large")
		chunks.push(c as Buffer)
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
}

const MODES: SearchMode[] = ["search", "budget", "sell"]
const CATEGORIES: Category[] = ["phone", "laptop", "tablet", "console", "tv", "headphones", "gpu", "watch"]

function toRequest(body: unknown): SearchRequest | null {
	if (!body || typeof body !== "object") return null
	const b = body as Partial<SearchRequest>
	const query = typeof b.query === "string" ? b.query.trim().slice(0, 300) : ""
	const mode = MODES.includes(b.mode as SearchMode) ? (b.mode as SearchMode) : "search"
	const category = CATEGORIES.includes(b.category as Category) ? (b.category as Category) : null
	const budget = typeof b.budget === "number" && b.budget > 0 ? Math.round(b.budget) : null
	if (!query && !(mode === "budget" && category)) return null
	if (mode === "budget" && !budget) return null
	return { mode, query, category, budget, origin: "web" }
}

/** One SSE stream per search: its live view and the agent log entries that belong to it. */
function openStream(id: string, req: IncomingMessage, res: ServerResponse) {
	res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" })
	send(res, "meta", { startedAt: state.startedAt, now: Date.now() })
	send(res, "log", state.log.filter((e) => e.searchId === id))
	let pending: LogEntry[] = []
	const offLog = state.onRecord((e) => {
		if (e.searchId === id) pending.push(e)
	})
	const flush = setInterval(() => {
		if (pending.length) send(res, "log", pending)
		pending = []
	}, 100)
	const offView = subscribe(id, (v) => send(res, "view", v))
	req.on("close", () => {
		offLog()
		offView()
		clearInterval(flush)
	})
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Behind a reverse proxy (TRUST_PROXY=1) the client address is the first X-Forwarded-For entry. */
const clientIp = (req: IncomingMessage) =>
	(process.env.TRUST_PROXY === "1" ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "") || req.socket.remoteAddress || "?"
/** At most PLAN_LIMIT new plans per address per hour. */
const PLAN_LIMIT = 20
const created = new Map<string, number[]>()
function allowPlan(ip: string): boolean {
	const now = Date.now()
	const recent = (created.get(ip) ?? []).filter((t) => now - t < 3_600_000)
	if (recent.length >= PLAN_LIMIT) return created.set(ip, recent), false
	created.set(ip, [...recent, now])
	if (created.size > 10_000) for (const [k, v] of created) if (v.every((t) => now - t >= 3_600_000)) created.delete(k)
	return true
}
const PRODUCT_LIST = CATALOGUE.map((p) => ({ id: p.id, name: p.model, brand: p.brand, category: p.category, typicalPrice: p.msrp }))
const barcodeRequests = new Map<string, { start: number; count: number }>()
function allowBarcode(ip: string): boolean {
	const now = Date.now()
	for (const [key, entry] of barcodeRequests) if (now - entry.start >= 60_000) barcodeRequests.delete(key)
	const entry = barcodeRequests.get(ip) ?? { start: now, count: 0 }
	if (entry.count >= 20 || (!barcodeRequests.has(ip) && barcodeRequests.size >= 10_000)) return false
	entry.count++; barcodeRequests.set(ip, entry)
	return true
}

async function api(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
	if (req.method === "GET" && path === "/api/health") return json(res, 200, { ok: true })
	if (req.method === "GET" && path === "/api/goal/example") return json(res, 200, EXAMPLE_GOAL)
	if (req.method === "GET" && path === "/api/products") return json(res, 200, PRODUCT_LIST)
	if (req.method === "POST" && path === "/api/barcode/lookup") {
		const body = await readBody(req).catch(() => null)
		const code = normalizeBarcode(body && typeof body === "object" ? (body as { barcode?: unknown }).barcode : null)
		if (!code) return json(res, 400, { error: "Enter a valid EAN-8, UPC-A, EAN-13 or GTIN-14 barcode, including its check digit." })
		if (!allowBarcode(clientIp(req))) return json(res, 429, { error: "Too many barcode lookups. Please wait a minute." })
		const result = await lookupBarcode(code)
		return json(res, result.status === "found" ? 200 : result.status === "not_found" ? 404 : 503, result)
	}
	if (req.method === "POST" && path === "/api/goal") {
		if (!allowPlan(clientIp(req))) return json(res, 429, { error: "Too many new plans from your address; try again later" })
		try { return json(res, 201, createGoal(await readBody(req))) }
		catch (error) { return json(res, 400, { error: errorText(error) }) }
	}
	if (req.method === "POST" && path === "/api/goal/from-prompt") {
		if (!allowPlan(clientIp(req))) return json(res, 429, { error: "Too many new plans from your address; try again later" })
		try { return json(res, 200, await createGoalFromPrompt(await readBody(req))) }
		catch (error) {
			if (error instanceof PromptError) return json(res, 422, { error: error.message, unknown: error.unknown })
			return json(res, 400, { error: errorText(error) })
		}
	}
	const goalRoute = /^\/api\/goal\/([\w-]+)(?:\/(stream|command))?$/.exec(path)
	if (goalRoute) {
		const id = goalRoute[1]
		const view = getGoal(id)
		if (!view) return json(res, 404, { error: "Plan not found" })
		if (req.method === "GET" && !goalRoute[2]) return json(res, 200, view)
		if (req.method === "GET" && goalRoute[2] === "stream") {
			res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" })
			const off = subscribeGoal(id, v => send(res, "view", v))
			const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15_000)
			req.on("close", () => { off(); clearInterval(heartbeat) })
			return
		}
		if (req.method === "POST" && goalRoute[2] === "command") {
			try { return json(res, 200, commandGoal(id, await readBody(req) as CommandRequest)) }
			catch (error) { return json(res, 409, { error: errorText(error), view: getGoal(id) }) }
		}
	}
	if (req.method === "POST" && path === "/api/search") {
		const request = toRequest(await readBody(req).catch(() => null))
		if (!request) return json(res, 400, { error: "query required (budget mode: budget and query or category)" })
		const running = [...state.sessions.values()].filter((s) => !s.done && !s.cancelled).length
		if (running >= MAX_RUNNING) return json(res, 429, { error: "too many searches running, try again in a few seconds" })
		return json(res, 200, { id: search(request) })
	}
	const m = /^\/api\/search\/([\w-]+)\/(stream|cancel)$/.exec(path)
	if (m && !resolveRuntime().state.session(m[1])) return json(res, 404, { error: "unknown search" })
	if (m && req.method === "GET" && m[2] === "stream") return openStream(m[1], req, res)
	if (m && req.method === "POST" && m[2] === "cancel") return cancel(m[1]), json(res, 200, {})
	json(res, 404, { error: "not found" })
}

// ---- HTTP ---------------------------------------------------------------

const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" }
const DIST = join(process.cwd(), "web", "dist")

const vite = PROD
	? null
	: await (await import("vite")).createServer({ configFile: "web/vite.config.ts", server: { middlewareMode: true }, appType: "spa" })

createServer((req, res) => {
	const path = new URL(req.url ?? "/", "http://x").pathname
	if (path.startsWith("/api/")) {
		api(req, res, path).catch((err) => json(res, 500, { error: String(err) }))
		return
	}
	if (vite) return vite.middlewares(req, res)

	const file = normalize(join(DIST, path === "/" ? "index.html" : path))
	const target = file.startsWith(DIST) && existsSync(file) ? file : join(DIST, "index.html")
	res.writeHead(200, { "Content-Type": MIME[extname(target)] ?? "application/octet-stream" })
	createReadStream(target).pipe(res)
}).listen(PORT, () => console.log(`RealDeal on http://localhost:${PORT}${PROD ? "" : " (dev)"}`))

// With a token, the Telegram bot runs in this process too, so web and bot searches share the same agents.
const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
if (token) {
	const { createBot } = await import("./bot/bot")
	createBot(token)
		.start({ onStart: (me) => console.log(`Telegram bot @${me.username} running`) })
		.catch((err) => console.error("[bot] could not start, the web server keeps running:", err))
}
