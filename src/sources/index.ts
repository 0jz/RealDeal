// Registry of source adapters. The search engine reads SOURCES and nothing else.
//
// Adding a site:
//   1. Write one SourceAdapter (search, optional detail) in its own file here.
//      Live adapters fetch through politeFetch() from ./http.ts: robots.txt, rate
//      limit, cache, retries and an honest User-Agent come with it.
//   2. Add recorded listings for it under data/fixtures/ (extend
//      fixtures/generate.ts) so the site can be exercised without touching it.
//   3. Register it below.
//
// Live mode is OFF for all three sites on purpose:
//   - KupujemProdajem: its terms (section 11) forbid copying or scraping its content.
//     Fixtures only.
//   - eponuda.rs: sits behind Cloudflare and we have no saved page to build a parser
//     against. Fixtures only.
//   - Cenoteka: mostly grocery comparison; only a thin electronics slice. Fixtures only.
//
// Gigatron (gigatron.rs) is the one live source, and only with LIVE_SOURCES=gigatron:
// see gigatron.ts for how it stays inside robots.txt and what its terms allow.

import { resolve } from "node:path"
import type { SourceAdapter } from "../search/types"
import { createFixtureAdapter } from "./fixture"
import { createGigatronAdapter } from "./gigatron"

const live = (process.env.LIVE_SOURCES ?? "").toLowerCase().split(",").map((s) => s.trim())
const fixture = (name: string) => resolve(process.cwd(), "data/fixtures", name)

export const SOURCES: SourceAdapter[] = [
	createFixtureAdapter({ id: "kp", name: "KupujemProdajem", kind: "classified", file: fixture("kp.json") }),
	createFixtureAdapter({ id: "eponuda", name: "eponuda", kind: "comparison", file: fixture("eponuda.json") }),
	createFixtureAdapter({ id: "cenoteka", name: "Cenoteka", kind: "comparison", file: fixture("cenoteka.json") }),
	...(live.includes("gigatron") ? [createGigatronAdapter()] : []),
]
