// Text normalization for listing titles and user queries: Serbian Cyrillic and
// Latin spellings, diacritics, punctuation, storage units and the boundary
// between letters and digits, so "s24ultra", "S24 Ultra" and "С24 Ултра" agree.

// Cyrillic to Latin with Serbian phonetics ("Про" = "Pro"). Cyrillic Р and С typed in
// place of Latin P and S ("РС5") come out as "rs5"; aliases.ts maps that back to "ps".
const CYRILLIC = new Map<string, string>([
	["а", "a"], ["б", "b"], ["в", "v"], ["г", "g"], ["д", "d"], ["ђ", "dj"], ["е", "e"], ["ж", "z"], ["з", "z"],
	["и", "i"], ["ј", "j"], ["к", "k"], ["л", "l"], ["љ", "lj"], ["м", "m"], ["н", "n"], ["њ", "nj"], ["о", "o"],
	["п", "p"], ["р", "r"], ["с", "s"], ["т", "t"], ["ћ", "c"], ["у", "u"], ["ф", "f"], ["х", "h"], ["ц", "c"],
	["ч", "c"], ["џ", "dz"], ["ш", "s"], ["ё", "e"], ["ы", "y"], ["э", "e"], ["ю", "ju"], ["я", "ja"], ["ъ", ""], ["ь", ""],
])

/** Storage sizes that a bare number may stand for ("iPhone 15 256" = 256 GB). */
const STORAGE_SIZES = new Set([16, 32, 64, 128, 256, 512, 1024, 2048])

/**
 * Lowercase, transliterate to Latin, strip diacritics, drop punctuation, write storage
 * as "<n>gb" (1 TB = 1024gb) and split letters from digits, except inside "<n>gb".
 * "iphone15pro" -> "iphone 15 pro", "WH-1000XM5" -> "wh 1000 xm 5", "256 GB" -> "256gb".
 */
export function normalize(text: string): string {
	const latin = [...text.toLowerCase()].map((ch) => CYRILLIC.get(ch) ?? ch).join("")
	let s = latin.replace(/đ/g, "dj").normalize("NFD").replace(/[̀-ͯ]/g, "")
	s = s
		.replace(/(?<=[a-z0-9])\+/g, " plus ")
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
	s = s.replace(/(\d+) ?tb\b/g, (_, n: string) => `${Number(n) * 1024}gb`)
	s = s.replace(/(\d+) ?(?:gb|giga[a-z]*)\b/g, "$1gb")
	s = s.replace(/(\d+) ?g\b/g, (m, n: string) => (STORAGE_SIZES.has(Number(n)) ? `${n}gb` : m))
	return s
		.split(" ")
		.filter(Boolean)
		.flatMap((t) => (/^\d+gb$/.test(t) ? [t] : t.split(/(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])/)))
		.join(" ")
}

/** Normalized words of a text, without empty entries. */
export function tokens(text: string): string[] {
	return normalize(text).split(" ").filter(Boolean)
}

/**
 * Storage in GB, or null. "8/256" is 8 GB RAM and 256 GB storage. A size next to
 * the word "ram" is RAM. Sizes below 16 GB are never storage (RAM, GPU memory).
 * A bare 64-1024 number counts only when no unit is written.
 */
export function extractStorage(text: string): number | null {
	const slash = /\b(\d{1,2})\s*[/+]\s*(\d{2,4})\b/.exec(text)
	if (slash && STORAGE_SIZES.has(Number(slash[2]))) return Number(slash[2])

	const words = tokens(text)
	for (let i = 0; i < words.length; i++) {
		const m = /^(\d+)gb$/.exec(words[i])
		if (!m || Number(m[1]) < 16) continue
		// "8gb ram 256gb": the ram label belongs to the 8, so the 256 is storage.
		const ramBefore = (words[i - 1] ?? "").startsWith("ram") && !/^\d+gb$/.test(words[i - 2] ?? "")
		if ((words[i + 1] ?? "").startsWith("ram") || ramBefore) continue
		return Number(m[1])
	}
	for (const w of words) {
		if (/^\d+$/.test(w) && [64, 128, 256, 512, 1024].includes(Number(w))) return Number(w)
	}
	return null
}
