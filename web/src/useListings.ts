import { useEffect, useState } from "react"
import type { ResultRow, SearchView } from "./types"

/** The cheapest real shop listing found for a catalogue product. */
export type Listing = { price: number; shipping: number | null; shop: string; url: string; image: string | null; checkedAt: Date }
/** undefined while the search runs; null when no real listing was found. */
export type Listings = Record<string, Listing | null | undefined>

const MAX_PARALLEL = 2
const TIMEOUT_MS = 20_000
const cache = new Map<string, Promise<Listing | null>>()
let active = 0
const waiting: (() => void)[] = []
const slot = () => new Promise<void>(go => { if (active < MAX_PARALLEL) { active++; go() } else waiting.push(() => { active++; go() }) })
const release = () => { active--; waiting.shift()?.() }

/** Fixture listings have made-up URLs, so only an https product page from a named shop counts. */
const real = (r: ResultRow) => !!r.shopName && r.url.startsWith("https://") && !r.url.includes("/fixture/")

function follow(id: string): Promise<SearchView | null> {
	return new Promise(resolve => {
		const es = new EventSource(`/api/search/${id}/stream`)
		const done = (v: SearchView | null) => { clearTimeout(timer); es.close(); resolve(v) }
		const timer = setTimeout(() => { void fetch(`/api/search/${id}/cancel`, { method: "POST" }).catch(() => {}); done(null) }, TIMEOUT_MS)
		es.addEventListener("view", m => { const v = JSON.parse((m as MessageEvent).data) as SearchView; if (v.done) done(v) })
		es.onerror = () => { if (es.readyState === EventSource.CLOSED) done(null) }
	})
}

async function lookup(productId: string, name: string): Promise<Listing | null> {
	await slot()
	try {
		const res = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "search", query: name, origin: "web" }) })
		if (!res.ok) return null
		const { id } = await res.json() as { id: string }
		const view = await follow(id)
		const best = (view?.groups.find(g => g.productId === productId)?.rows ?? []).filter(real).sort((a, b) => a.total - b.total)[0]
		return best ? { price: best.price, shipping: best.shipping, shop: best.shopName!, url: best.url, image: best.image ?? null, checkedAt: new Date() } : null
	} catch { return null }
	finally { release() }
}

/** Looks up the best listing for each product, at most two searches at a time, cached for the page's lifetime. */
export function useListings(products: { id: string; name: string }[]): Listings {
	const [found, setFound] = useState<Listings>({})
	const key = products.map(p => p.id).join(",")
	useEffect(() => {
		let alive = true
		for (const p of products) {
			if (!cache.has(p.id)) cache.set(p.id, lookup(p.id, p.name))
			void cache.get(p.id)!.then(l => { if (alive) setFound(f => ({ ...f, [p.id]: l })) })
		}
		return () => { alive = false }
	}, [key])
	return found
}
