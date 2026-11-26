// A source that reads recorded listings from a JSON file and imitates a dumb
// literal site search: no typo correction, no transliteration, no synonyms.
// That is the point: the engine has to expand queries itself.

import { readFile } from "node:fs/promises"
import type { RawListing, SearchPage, SourceAdapter, SourceKind } from "../search/types"

export type FixtureOptions = {
	id: string
	name: string
	kind: SourceKind
	/** Absolute path to a JSON array of RawListing. */
	file: string
	pageSize?: number
	/** Simulated network latency, [min, max] ms. */
	latencyMs?: [number, number]
}

/** Lowercase and strip Latin diacritics (č -> c). Cyrillic is left alone on purpose. */
export const normalize = (s: string) => s.toLowerCase().replace(/đ/g, "d").normalize("NFD").replace(/[̀-ͯ]/g, "")

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function createFixtureAdapter(opts: FixtureOptions): SourceAdapter {
	const pageSize = opts.pageSize ?? 12
	const [minMs, maxMs] = opts.latencyMs ?? [150, 700]
	let loaded: Promise<RawListing[]> | null = null
	const load = () => (loaded ??= readFile(opts.file, "utf8").then((text) => JSON.parse(text) as RawListing[]))
	const latency = () => sleep(minMs + Math.random() * (maxMs - minMs))

	return {
		id: opts.id,
		name: opts.name,
		kind: opts.kind,
		live: false,

		async search(term: string, page: number): Promise<SearchPage> {
			const listings = await load()
			await latency()
			const words = normalize(term).split(/\s+/).filter(Boolean)
			const hits = words.length === 0 ? [] : listings.filter((l) => {
				const haystack = normalize(`${l.title} ${l.description ?? ""}`)
				return words.every((w) => haystack.includes(w))
			})
			const start = (Math.max(1, page) - 1) * pageSize
			return { listings: hits.slice(start, start + pageSize), hasMore: start + pageSize < hits.length }
		},

		async detail(listing: RawListing): Promise<Partial<RawListing>> {
			const listings = await load()
			await sleep(50 + Math.random() * 150)
			const found = listings.find((l) => l.id === listing.id)
			return { description: found?.description ?? null }
		},
	}
}
