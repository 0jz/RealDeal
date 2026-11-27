// A source that reads recorded listings from a JSON file and implements a literal
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
	/** Deprecated, ignored. Fixture work uses actual asynchronous file reads. */
	latencyMs?: [number, number]
}

import { normalize } from "./text"
export { normalize } from "./text"

export function createFixtureAdapter(opts: FixtureOptions): SourceAdapter {
	const pageSize = opts.pageSize ?? 12
	const load = () => readFile(opts.file, "utf8").then((text) => JSON.parse(text) as RawListing[])

	return {
		id: opts.id,
		name: opts.name,
		kind: opts.kind,
		live: false,

		async search(term: string, page: number): Promise<SearchPage> {
			const listings = await load()
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
			const found = listings.find((l) => l.id === listing.id)
			return { description: found?.description ?? null }
		},
	}
}
