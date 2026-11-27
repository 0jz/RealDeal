// QueryAgent: offline search strings and the shops that sell each kind of thing.

import type { ScoutSite, ScoutWant } from "./types"

/** Fold Serbian diacritics for search boxes that do not handle them. */
export function fold(text: string): string {
	return text
		.replace(/[đђ]/g, "dj")
		.replace(/[ĐЂ]/g, "Dj")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
}

function words(text: string): string[] {
	return fold(text)
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean)
}

/** The typed query, its folded twin, then queries with the first attributes, max four. */
export function buildQueries(want: ScoutWant): string[] {
	const out: string[] = []
	const add = (text: string) => {
		const query = text.trim().replace(/\s+/g, " ")
		const key = query.toLowerCase()
		if (query && !out.some((q) => q.toLowerCase() === key)) out.push(query)
	}
	add(want.query)
	add(fold(want.query))
	for (const attribute of want.attributes) add(`${want.query} ${attribute}`)
	return out.slice(0, 4)
}

const CLOTHING = new Set([
	"jakna", "jakne", "jaknu", "majica", "majice", "patike", "patika", "cipele", "cizme", "pantalone",
	"farmerke", "haljina", "duks", "dzemper", "kaput", "carape", "obuca", "jacket", "jackets", "shoes",
	"sneakers", "dress", "hoodie", "shirt", "tshirt", "jeans", "boots", "socks", "sweater", "coat",
])

/** Electronics shops do not sell clothing or shoes; Ananas and Office Shoes do. */
export function siteFits(site: ScoutSite, want: ScoutWant): boolean {
	if (site === "ananas" || site === "officeshoes") return true
	return !words(want.query).some((word) => CLOTHING.has(word))
}
