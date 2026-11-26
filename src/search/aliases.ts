// Brand and model words that Serbian sellers misspell or write differently, mapped
// to the canonical word. Keys and values are already normalized (lowercase Latin,
// no diacritics). A key may have several words ("play station"), and a value may
// expand to several ("pro max").

const ALIASES = new Map<string, string>([
	// Apple
	["ajfon", "iphone"], ["ajfoun", "iphone"], ["ajfone", "iphone"], ["ajfn", "iphone"], ["aifon", "iphone"],
	["ifon", "iphone"], ["ifone", "iphone"], ["iphon", "iphone"], ["iphne", "iphone"],
	["maks", "max"], ["macs", "max"], ["promax", "pro max"],
	["mekbuk", "macbook"], ["makbuk", "macbook"], ["mekbuc", "macbook"], ["mac book", "macbook"],
	["ajped", "ipad"], ["ajpad", "ipad"], ["ipet", "ipad"],
	["erpods", "airpods"], ["ejrpods", "airpods"], ["air pods", "airpods"],
	["epl", "apple"], ["eple", "apple"], ["ajpl", "apple"],
	// Samsung
	["samsumg", "samsung"], ["samsun", "samsung"], ["samsnug", "samsung"], ["samung", "samsung"], ["samsugn", "samsung"],
	["galaksi", "galaxy"], ["galaxi", "galaxy"], ["galaksy", "galaxy"], ["galeksi", "galaxy"],
	// Sony and PlayStation ("ps" is the canonical word for PlayStation)
	["plejstejsn", "ps"], ["plejstejsen", "ps"], ["plejstejson", "ps"], ["playstation", "ps"], ["play station", "ps"],
	["rs", "ps"], // "РС5": Cyrillic Р and С typed for Latin P and S
	["soni", "sony"],
	// Xiaomi, Redmi, Google, Microsoft, Nintendo
	["ksiaomi", "xiaomi"], ["sjaomi", "xiaomi"], ["xiomi", "xiaomi"], ["xaomi", "xiaomi"], ["ksiomi", "xiaomi"],
	["redmy", "redmi"],
	["piksel", "pixel"], ["piksl", "pixel"],
	["iksboks", "xbox"], ["x box", "xbox"], ["ksbox", "xbox"],
	["svic", "switch"], ["nintedo", "nintendo"], ["nitendo", "nintendo"],
	// Common words in model names
	["ultar", "ultra"], ["utra", "ultra"], ["ultr", "ultra"],
	["dsk", "disc"], ["disk", "disc"],
	["dig", "digital"], ["digi", "digital"],
	["viktus", "victus"], ["lenovu", "lenovo"], ["idepad", "ideapad"], ["azus", "asus"],
	["gefors", "geforce"], ["gforce", "geforce"], ["radeo", "radeon"], ["rtks", "rtx"], ["nvidija", "nvidia"],
	["motorla", "motorola"], ["huavei", "huawei"], ["laptp", "laptop"], ["leptop", "laptop"],
	["gejming", "gaming"], ["gejmig", "gaming"], ["serijes", "series"],
	["slusalica", "slusalice"],
])

/** Canonical form of one normalized word. Unknown words come back unchanged. */
export function canonicalWord(w: string): string {
	return ALIASES.get(w) ?? w
}

/** Normalized misspellings and alternative spellings of one canonical word. */
export function misspellingsOf(canonical: string): string[] {
	return [...ALIASES].filter(([, value]) => value === canonical).map(([key]) => key)
}

/**
 * Replace known misspellings with canonical words, longest phrase first. "pm" after
 * an iPhone number (11-17) means "pro max". Input and output are normalized tokens.
 */
export function applyAliases(words: string[]): string[] {
	const out: string[] = []
	let i = 0
	while (i < words.length) {
		let consumed = 0
		for (let n = Math.min(3, words.length - i); n >= 1 && consumed === 0; n--) {
			const value = ALIASES.get(words.slice(i, i + n).join(" "))
			if (value !== undefined) {
				out.push(...value.split(" "))
				consumed = n
			}
		}
		if (consumed === 0) {
			const w = words[i]
			const prev = out[out.length - 1] ?? ""
			if (w === "pm" && /^1[1-7]$/.test(prev)) out.push("pro", "max")
			else out.push(w)
			consumed = 1
		}
		i += consumed
	}
	return out
}
