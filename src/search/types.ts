// Shared contract for the search engine. Every module (matcher, sources,
// agents, server, bot, UI) agrees on these shapes. Change them rarely.

export type Category = "phone" | "laptop" | "tablet" | "console" | "tv" | "headphones" | "gpu" | "watch"

export type Condition = "new" | "sealed" | "used"

/** One canonical model in the catalogue. Storage is a listing attribute, not part of the product. */
export type Product = {
	id: string // e.g. "iphone-15-pro"
	brand: string // "Apple"
	model: string // "iPhone 15 Pro"
	category: Category
	year: number
	/** 0-100, how good the device is within its category. Drives "best for the money". */
	score: number
	/** Approximate new price in RSD for the base configuration. Baseline for market price. */
	msrp: number
	/** Storage options in GB, when the product has them. First is the base one. */
	storages?: number[]
	/** Extra spellings beyond what the alias dictionary generates (e.g. "ajfon 15 pro"). */
	aliases?: string[]
}

export type SourceKind = "classified" | "shop" | "comparison"

/** A listing exactly as a source reported it, before matching. Prices in RSD. */
export type RawListing = {
	source: string // adapter id, e.g. "kp"
	id: string // unique within the source
	url: string
	title: string
	description?: string | null
	price: number
	/** Delivery cost in RSD when the source states it. null = unknown. */
	shipping?: number | null
	condition?: Condition | null
	city?: string | null
	seller?: { name: string; rating?: number | null; reviews?: number | null } | null
	/** For shop listings: which shop sells it (one comparison site lists many shops). */
	shopId?: string | null
	shopName?: string | null
	/** Shop listings only: last 60 daily prices (index 59 = yesterday, null = not in stock) and the advertised previous price, for the 30-day rule. */
	history?: (number | null)[] | null
	shownPrevPrice?: number | null
	/** Product picture URL (https only) when the source gives one. */
	image?: string | null
}

export type MatchMethod = "rule" | "fuzzy" | "llm" | "none"

export type MatchResult = {
	productId: string | null
	/** 0-1 */
	confidence: number
	method: MatchMethod
	/** Set when the listing was rejected: accessory, broken, locked, replica, wrong model… */
	reject?: string | null
	storageGb?: number | null
	condition?: Condition | null
}

export type SearchPage = { listings: RawListing[]; hasMore: boolean }

/** One site. Adding a site = writing one of these and registering it in src/sources/index.ts. */
export interface SourceAdapter {
	id: string
	name: string
	kind: SourceKind
	/** true = talks to the real site, false = reads recorded fixtures. */
	live: boolean
	/** One page (1-based) of the site's own search for a literal search term. */
	search(term: string, page: number): Promise<SearchPage>
	/** Open a listing's detail page to fill fields the result snippet lacked. */
	detail?(listing: RawListing): Promise<Partial<RawListing>>
}

// ---- Requests and live views (sent to the website over SSE and to the bot) ----

export type SearchMode = "search" | "budget" | "sell"

export type SearchRequest = {
	mode: SearchMode
	/** What the user typed: "iphone 15 pro", "telefon", "iPhone 13 128GB used baterija 86%". */
	query: string
	/** Budget mode: hard cap in RSD, including delivery when known. */
	budget?: number | null
	category?: Category | null
	/** Who asked, for logs only ("web", "telegram"). */
	origin?: string
}

export type PriceFlag = "great" | "good" | "fair" | "high" | "suspicious"

export type ResultRow = {
	key: string // `${source}|${id}`
	source: string
	sourceName: string
	kind: SourceKind
	title: string
	url: string
	price: number
	shipping: number | null
	/** price + shipping (shipping counted as 0 when unknown). What the budget is checked against. */
	total: number
	condition: Condition | null
	city: string | null
	shopName: string | null
	/** Product picture URL (https only), null when the source gives none. */
	image: string | null
	storageGb: number | null
	productId: string
	confidence: number
	method: MatchMethod
	/** Market median for this product + condition, when known. */
	market: number | null
	flag: PriceFlag | null
	/** Shop listings: the 30-day-rule check on its advertised discount. */
	thirtyDay: { legal: boolean; realLow: number; claimedPct: number; realPct: number } | null
	shopTrust: number | null
	/** Higher is better. Used to order rows and choose picks. */
	score: number
	why: string
}

export type ProductGroup = {
	productId: string
	name: string
	category: Category
	low: number
	market: number | null
	rows: ResultRow[] // sorted by total, ascending
}

export type Pick = { key: string; productId: string; name: string; total: number; leftover: number; why: string }

export type SellEstimate = {
	productId: string | null
	name: string | null
	condition: Condition
	storageGb: number | null
	quick: number | null // price that sells within days
	patient: number | null // price worth waiting for
	comps: Array<{ key: string; title: string; price: number; url: string }>
	draft: { title: string; description: string } | null
	note: string
}

export type SourceStatus = { id: string; name: string; live: boolean; state: "idle" | "searching" | "done"; pages: number; found: number }

export type SearchView = {
	id: string
	request: SearchRequest
	startedAt: number
	terms: string[]
	sources: SourceStatus[]
	groups: ProductGroup[]
	picks: Pick[]
	rejected: number
	sell: SellEstimate | null
	done: boolean
}
