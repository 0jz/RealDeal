// The customer profile shared by the live comparison-site adapters
// (eponuda, cenoteka). Both sites sit behind Cloudflare with a *scoring*
// challenge: an honest bot user-agent or a Chrome UA alone gets a 403
// challenge page, while a request whose headers look like a coherent real
// browser is served normally (verified 2026-11-27, plain fetch/undici TLS —
// no JA3 impersonation involved).
//
// This file is the one place that decision lives: these adapters present
// themselves as a browser rather than as RealDealBot. That deliberately gives
// up the "identify yourself so operators can block you" property documented
// in docs/LEGAL_REFERENCE.md — keep it off by default (LIVE_SOURCES), keep the
// request volume low, and re-check the sites' terms before anything public.
//
// Rate-limit behaviour we measured: a burst of sparse-header requests to one
// host flips that host (sometimes the whole IP) into managed challenges.
// CUSTOMER_INTERVAL_MS + jitter keeps a steady human-ish pace instead.

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { HttpError, politeFetch, type Transport } from "./http"

const exec = promisify(execFile)

/** The OS curl as a fetch transport, used by the comparison adapters.
 *
 * Why not Node's fetch: eponuda's Cloudflare WAF answers Node's requests with a
 * hard 403 "Attention Required!" block even when every header matches Chrome
 * exactly — the TLS profile (OpenSSL) with a browser UA is itself the trigger.
 * The same request from the OS's own curl (Schannel on Windows) returns 200
 * (measured 2026-11-27, seconds apart, same IP). So these adapters use the
 * system HTTP client rather than a browser-impersonation toolkit; on Linux the
 * curl fingerprint differs and may need re-testing per host.
 */
/** Chrome's exact HTTP/1.1 header-name casing. Measured on eponuda's WAF: the
 * identical request passes with these spellings and is blocked (403) when the
 * same names go out lowercase — Cloudflare fingerprints the raw header bytes.
 * The sec-ch-ua* family stays lowercase, exactly like Chrome sends it. */
const HEADER_CASE: Record<string, string> = {
	"user-agent": "User-Agent",
	accept: "Accept",
	"accept-language": "Accept-Language",
	"accept-encoding": "Accept-Encoding",
	"sec-fetch-dest": "Sec-Fetch-Dest",
	"sec-fetch-mode": "Sec-Fetch-Mode",
	"sec-fetch-site": "Sec-Fetch-Site",
	"sec-fetch-user": "Sec-Fetch-User",
	"upgrade-insecure-requests": "Upgrade-Insecure-Requests",
}

export const curlTransport: Transport = async (url, headers) => {
	const args = ["-sS", "--compressed", "-m", "15"]
	for (const [name, value] of Object.entries(headers)) args.push("-H", `${HEADER_CASE[name] ?? name}: ${value}`)
	args.push("-w", "\n%{http_code}", url)
	try {
		const { stdout } = await exec("curl", args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true })
		const split = stdout.lastIndexOf("\n")
		const status = Number(stdout.slice(split + 1).trim())
		const body = stdout.slice(0, split)
		if (Number.isFinite(status) && status >= 400) throw new HttpError(status, url)
		return body
	} catch (err) {
		if (err instanceof HttpError) throw err
		// curl missing or refused to start: fall back to Node's fetch rather than failing the search.
		const message = err instanceof Error ? err.message : String(err)
		if (/ENOENT|not found|command not found/i.test(message)) return await nodeFetchRaw(url, headers)
		throw new Error(message)
	}
}

const nodeFetchRaw: Transport = async (url, headers) => {
	const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) })
	if (res.ok) return await res.text()
	throw new HttpError(res.status, url)
}

/** A coherent Chrome/Windows customer browsing from Serbia. */
export const CUSTOMER_HEADERS: Record<string, string> = {
	"user-agent":
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	accept:
		"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
	"accept-language": "sr-RS,sr;q=0.9,en-US;q=0.8,en;q=0.7",
	"sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
	"sec-ch-ua-mobile": "?0",
	"sec-ch-ua-platform": '"Windows"',
	"sec-fetch-dest": "document",
	"sec-fetch-mode": "navigate",
	"sec-fetch-site": "none",
	"sec-fetch-user": "?1",
	"upgrade-insecure-requests": "1",
}

/** Minimum gap between requests to one comparison host (their queue is per host). */
export const CUSTOMER_INTERVAL_MS = 3000
/** Random extra wait so consecutive requests don't land on a metronome. */
export const CUSTOMER_JITTER_MS = 1500

/** Cloudflare interstitials (managed challenge, "Just a moment", block pages).
 * The `challenge-platform` beacon script is deliberately NOT listed: Cloudflare
 * injects it into every proxied page, including ones it serves normally. */
export const CHALLENGE_HTML = /Just a moment\.\.\.|_cf_chl_opt|cf_chl_opt|cf_chl_|Enable JavaScript and cookies|Attention Required!|cf-mitigated/i

/** True when a fetched body is a Cloudflare challenge, not the page we asked for. */
export const isChallenge = (body: string) => CHALLENGE_HTML.test(body)

// When a host answers with a challenge or a 403, its score has flipped against
// us; more requests make it worse. A real customer who hits "Just a moment…"
// stops and comes back later — the adapters do the same: the host is skipped
// until the cool-down expires, and the fetches that were already spaced keep
// their distance.

const blockedUntil = new Map<string, number>()

/** Records that a host challenged us; it will be skipped for the next minutes. */
export function noteBlocked(url: string, minutes = 10): void {
	const host = new URL(url).host
	blockedUntil.set(host, Date.now() + minutes * 60_000)
	console.error(`[customer] ${host} challenged us; backing off for ${minutes} min`)
}

/** True while a host is in its cool-down. Self-clears when the cool-down expires. */
export function isBackedOff(url: string): boolean {
	const host = new URL(url).host
	const until = blockedUntil.get(host)
	if (until === undefined) return false
	if (Date.now() >= until) {
		blockedUntil.delete(host)
		return false
	}
	return true
}

/** A polite fetch that behaves like the customer above: skips a challenged host instead of hammering it. */
export async function customerFetch(url: string): Promise<string | null> {
	if (isBackedOff(url)) return null
	try {
		const html = await politeFetch(url, {
			headers: CUSTOMER_HEADERS,
			minIntervalMs: CUSTOMER_INTERVAL_MS,
			jitterMs: CUSTOMER_JITTER_MS,
			transport: curlTransport,
		})
		if (isChallenge(html)) {
			noteBlocked(url)
			return null
		}
		return html
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		if (/HTTP 40[13]/.test(message)) noteBlocked(url)
		console.error(`[customer] fetch ${url} failed: ${message}`)
		return null
	}
}
