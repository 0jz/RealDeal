import "dotenv/config"
import { createReadStream, existsSync } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { extname, join, normalize } from "node:path"
import type { VerdictUpdated } from "./agents/events"
import { offerKey, type LogEntry } from "./runtime"
import { Feed, observeVerdicts, startSwarm } from "./swarm"

// One process: the Mozaik swarm, a small JSON API, an SSE stream, and the UI
// (Vite middleware in dev, the built files with --prod).

const PORT = Number(process.env.PORT ?? 8787)
const PROD = process.argv.includes("--prod")

const state = startSwarm(2611)
const feed = new Feed(state)
const flips: Array<VerdictUpdated & { t: number }> = []
observeVerdicts((u) => {
	flips.push(u)
	if (flips.length > 40) flips.shift()
}, state)

// ---- SSE ----------------------------------------------------------------

const clients = new Set<ServerResponse>()
let pendingLog: LogEntry[] = []
let dirty = true

state.onRecord((e) => {
	pendingLog.push(e)
	dirty = true
})

function send(res: ServerResponse, event: string, data: unknown) {
	res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function snapshot() {
	const offers = [...state.verdicts.values()].map((v) => {
		const shown = state.prices.get(offerKey(v.shopId, v.skuId))!
		return {
			key: offerKey(v.shopId, v.skuId),
			shopId: v.shopId,
			skuId: v.skuId,
			price: v.price,
			shownPrevPrice: shown.shownPrevPrice,
			realLow: v.discount?.realLow ?? null,
			windowDays: v.discount?.windowDays ?? null,
			claimedPct: v.discount?.claimedDiscountPct ?? null,
			realPct: v.discount?.realDiscountPct ?? null,
			kpSealed: v.kp?.sealedLow ?? null,
			bestShopId: v.crossShop?.bestShopId ?? null,
			bestPrice: v.crossShop?.bestPrice ?? null,
			verdict: v.verdict,
			reason: v.reason,
		}
	})
	return {
		running: feed.running,
		speed: feed.speed,
		emitted: feed.emitted,
		total: feed.total,
		trust: Object.fromEntries(state.trust),
		offers,
		flips: [...flips].reverse(),
	}
}

// Batch: timeline entries every 100 ms, a state snapshot when something changed.
setInterval(() => {
	if (pendingLog.length) {
		for (const c of clients) send(c, "log", pendingLog)
		pendingLog = []
	}
	if (dirty) {
		const s = snapshot()
		for (const c of clients) send(c, "state", s)
		dirty = false
	}
}, 100)

function openStream(req: IncomingMessage, res: ServerResponse) {
	res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" })
	send(res, "meta", { shops: state.data.shops, skus: state.data.skus, startedAt: state.startedAt, now: Date.now() })
	send(res, "log", state.log.slice(-400))
	send(res, "state", snapshot())
	clients.add(res)
	req.on("close", () => clients.delete(res))
}

// ---- API ----------------------------------------------------------------

function api(path: string, res: ServerResponse): boolean {
	const ok = (body: unknown = {}) => {
		dirty = true
		res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body))
	}
	switch (path) {
		case "/api/start":
			feed.start()
			return ok(), true
		case "/api/pause":
			feed.pause()
			return ok(), true
		case "/api/speed/1":
		case "/api/speed/10":
			feed.setSpeed(Number(path.split("/").pop()))
			return ok(), true
		case "/api/inject": {
			const o = feed.injectFake()
			return ok({ injected: o ? offerKey(o.shopId, o.skuId) : null }), true
		}
		case "/api/reset":
			feed.reset()
			flips.length = 0
			pendingLog = []
			for (const c of clients) send(c, "reset", { startedAt: state.startedAt, now: Date.now() })
			return ok(), true
	}
	return false
}

// ---- HTTP ---------------------------------------------------------------

const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" }
const DIST = join(process.cwd(), "web", "dist")

const vite = PROD
	? null
	: await (await import("vite")).createServer({ configFile: "web/vite.config.ts", server: { middlewareMode: true }, appType: "spa" })

createServer((req, res) => {
	const path = new URL(req.url ?? "/", "http://x").pathname
	if (path === "/events") return openStream(req, res)
	if (path.startsWith("/api/")) {
		if (req.method !== "POST" || !api(path, res)) res.writeHead(404).end()
		return
	}
	if (vite) return vite.middlewares(req, res)

	const file = normalize(join(DIST, path === "/" ? "index.html" : path))
	const target = file.startsWith(DIST) && existsSync(file) ? file : join(DIST, "index.html")
	res.writeHead(200, { "Content-Type": MIME[extname(target)] ?? "application/octet-stream" })
	createReadStream(target).pipe(res)
}).listen(PORT, () => console.log(`RealDeal on http://localhost:${PORT}${PROD ? "" : " (dev)"}`))
