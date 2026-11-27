// Shared search-term → category-page mapping for the comparison adapters.
// Both sites expose server-rendered category pages instead of crawlable
// search (eponuda's robots.txt even disallows its search), so both adapters
// work the same way: find the category page, filter its items locally.
//
// "generic" words (telefon, laptop…) identify the category but never appear in
// product names, so they are dropped from the required tokens. Model words
// (iphone, rtx…) also pick the category but stay required — that keeps
// "iphone 15" from matching every phone with a 15 in it.

import { normalize } from "./fixture"

type CategoryMap = {
	/** Any token matching this picks the category. */
	match: RegExp
	/** Only these tokens are dropped from the term's required words. */
	generic: RegExp
	cenoteka: string
	eponuda: string
}

export const CATEGORY_MAP: CategoryMap[] = [
	{ match: /(telefon|mobilni|iphone|galaxy|pixel|redmi|xiaomi|huawei|honor)/, generic: /(telefon|mobilni)/, cenoteka: "mobilni-telefoni-cene", eponuda: "mobilni-telefoni-cene" },
	{ match: /(laptop|laptopovi|macbook|ideapad|thinkpad|victus|tuf)/, generic: /(laptop|laptopovi)/, cenoteka: "laptopovi-cene", eponuda: "laptopovi-cene" },
	{ match: /(televizor|oled|qled|\btv\b)/, generic: /(televizor)/, cenoteka: "televizori-cene", eponuda: "televizori-cene" },
	{ match: /(tablet|ipad)/, generic: /(tablet)/, cenoteka: "tableti-cene", eponuda: "tableti-cene" },
	{ match: /(slusalic|airpods|buds|headphone|\bxm[45]\b)/, generic: /(slusalic|headphone)/, cenoteka: "slusalice-cene", eponuda: "slusalice-cene" },
	{ match: /(grafic|rtx|gtx|radeon|\bgpu\b)/, generic: /(grafic|\bgpu\b)/, cenoteka: "graficke-kartice-cene", eponuda: "graficke-kartice-cene" },
	{ match: /(konzol|gejming|playstation|plejstejsn|xbox|ps5|switch|svic)/, generic: /(konzol|gejming)/, cenoteka: "gaming-konzole-cene", eponuda: "igracke-konzole-cene" },
	{ match: /(sat|watch|garmin|fitbit)/, generic: /(sat|watch)/, cenoteka: "pametni-satovi-cene", eponuda: "pametni-satovi-cene" },
	{ match: /(monitor)/, generic: /(monitor)/, cenoteka: "monitori-cene", eponuda: "monitori-cene" },
]

export function termWords(term: string): string[] {
	return normalize(term).split(/[\s-]+/).filter(Boolean)
}

/** The category a term belongs to, or null when no token maps to one. */
export function pickCategory(term: string): (CategoryMap & { words: string[] }) | null {
	const words = termWords(term)
	const entry = CATEGORY_MAP.find((c) => words.some((w) => c.match.test(w)))
	return entry ? { ...entry, words } : null
}

/** The term's words that product names must contain: everything except the generic category words. */
export function requiredWords(entry: { words: string[]; generic: RegExp }): string[] {
	return entry.words.filter((w) => !entry.generic.test(w))
}

/** Words that mark an accessory rather than the device itself ("daljinski za PS5").
 *  Compared against the normalized name; accessories are dropped before matching,
 *  exactly like the gigatron scout does with its slugs. */
const ACCESSORY_WORDS =
	/(zastitn|maska|futrol|stakl|folij|punjac|punjiv|kabl|adapter|drzac|nosac|postolj|dock|hub|daljinski|remote|kontroler|torb|silikon|narukvic|remen|baterij|slusalice za|punocu|sta(k|nd) za|kuciste|rezervni|kamera|oprema|igrice|igrice)/

export function isAccessoryName(name: string): boolean {
	return ACCESSORY_WORDS.test(normalize(name))
}

/** True when a name (already normalized) contains every required word. */
export function nameMatches(name: string, required: string[]): boolean {
	return required.length === 0 || required.every((w) => name.includes(w))
}
