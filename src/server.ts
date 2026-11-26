import "dotenv/config"
import { createReadStream, existsSync } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { extname, join, normalize } from "node:path"
import { resolveRuntime, type LogEntry } from "./runtime"
import { cancel, search, startEngine, subscribe } from "./search/engine"
import type { Category, SearchMode, SearchRequest } from "./search/types"

// One process: the Mozaik search swarm, a small JSON API, an SSE stream per
// search, and the UI (Vite middleware in dev, the built files with --prod).

const PORT = Number(process.env.PORT ?? 8787)
const PROD = process.argv.includes("--prod")

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

async function api(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
	if (req.method === "POST" && path === "/api/search") {
		const request = toRequest(await readBody(req).catch(() => null))
		if (!request) return json(res, 400, { error: "query required (budget mode: budget and query or category)" })
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
