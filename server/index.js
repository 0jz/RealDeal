// One Node.js process: REST API + Server-Sent Events + the static frontend. No build step.
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { ROOT } from "./data.js";

// Minimal .env loader (KEY=VALUE lines); real environment variables win.
const envFile = join(ROOT, ".env");
if (existsSync(envFile)) for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

// @mozaik-ai/cloud-sdk prints the same "telemetry disabled" notice for every agent loop; show it once.
const warn = console.warn.bind(console); let cloudNoticeShown = false;
console.warn = (...a) => { if (String(a[0]).startsWith("mozaik cloud: no API key")) { if (cloudNoticeShown) return; cloudNoticeShown = true; } warn(...a); };

const { createApp } = await import("./app.js");
const { bus } = await import("./tasks.js");
const app = createApp();
const PUBLIC = join(ROOT, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };

const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } }); });

const handler = async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;
  try {
    if (path === "/api/health") return json(res, 200, { ok: true, mode: app.cfg.mode });
    if (path === "/api/meta") return json(res, 200, app.meta());
    if (path === "/api/summary") return json(res, 200, app.summary());
    if (path === "/api/products") return json(res, 200, app.findProducts(url.searchParams.get("q")));
    if (path === "/api/scans" && req.method === "POST") {
      const body = await readBody(req); const r = app.startScan(body.code || body.q);
      return r ? json(res, 201, { runId: r.run.id, product: r.product }) : json(res, 404, { error: "no product in the synthetic dataset matches that code or name" });
    }
    if (path === "/api/runs" && req.method === "POST") { const body = await readBody(req); const run = app.startRun(body.listId); return json(res, 201, { runId: run.id }); }
    let m;
    if ((m = /^\/api\/runs\/([\w-]+)$/.exec(path))) { const s = app.snapshot(m[1]); return s ? json(res, 200, s) : json(res, 404, { error: "run not found" }); }
    if ((m = /^\/api\/scans\/([\w-]+)$/.exec(path))) { const r = app.scanResult(m[1]); return r ? json(res, 200, r) : json(res, 404, { error: "scan not found" }); }
    if ((m = /^\/api\/runs\/([\w-]+)\/next-page$/.exec(path)) && req.method === "POST") return json(res, app.nextPage(m[1]) ? 202 : 404, {});
    if ((m = /^\/api\/runs\/([\w-]+)\/stream$/.exec(path))) {
      const snap = app.snapshot(m[1]); if (!snap) return json(res, 404, { error: "run not found" });
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
      res.write(`event: snapshot\ndata: ${JSON.stringify(snap)}\n\n`);
      const unsub = bus.subscribe(m[1], res);
      const ping = setInterval(() => res.write(": ping\n\n"), 15000);
      req.on("close", () => { clearInterval(ping); unsub(); });
      return;
    }
    if (path === "/api/source") { const s = app.source(url.searchParams.get("ref") || "", url.searchParams.get("run")); return s ? json(res, 200, s) : json(res, 404, { error: "unknown source" }); }
    // static
    const file = normalize(join(PUBLIC, path === "/" ? "index.html" : path));
    if (!file.startsWith(PUBLIC)) return json(res, 403, { error: "forbidden" });
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch (e) {
    if (e.code === "ENOENT") return json(res, 404, { error: "not found" });
    console.error(e); json(res, 500, { error: "internal error" });
  }
};
// Phones only allow camera access on https:// (or localhost). Set HTTPS_KEY and HTTPS_CERT to serve TLS directly,
// or put the app behind Caddy / a tunnel that terminates TLS.
const tls = process.env.HTTPS_KEY && process.env.HTTPS_CERT ? { key: readFileSync(process.env.HTTPS_KEY), cert: readFileSync(process.env.HTTPS_CERT) } : null;
const server = tls ? createHttpsServer(tls, handler) : createServer(handler);

process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
server.listen(PORT, HOST, () => {
  const c = app.cfg;
  console.log(`Black Friday Check running on ${tls ? "https" : "http"}://localhost:${PORT}`);
  console.log(c.mode === "llm" ? `LLM mode: ${c.model} via ${c.provider}` : `NO-KEY TEMPLATE MODE (${c.reason}). Set OPENAI_API_KEY (see .env.example) for real LLM agents.`);
});
const shutdown = () => { server.close(); app.close().finally(() => process.exit(0)); };
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
