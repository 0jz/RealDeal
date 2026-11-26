import NumberFlow from "@number-flow/react"
import { Cpu, Gamepad2, Headphones, Laptop, Smartphone, Tablet, Tv, Watch, type LucideIcon } from "lucide-react"
import type { Wish } from "../../src/finance/types"
import { priceLabel, type Product } from "./Finance"
import type { Listing, Listings } from "./useListings"

const ICON: Record<string, LucideIcon> = { phone: Smartphone, laptop: Laptop, tablet: Tablet, console: Gamepad2, tv: Tv, headphones: Headphones, gpu: Cpu, watch: Watch }
const time = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })

/** What to show as a product's price, with its honest label. */
function priceOf(listing: Listing | null | undefined, fallback: number, own: boolean): { amount: number; label: string; listing: Listing | null } {
	if (own) return { amount: fallback, label: priceLabel("you"), listing: null }
	if (listing) return { amount: listing.price, label: `at ${listing.shop} · checked ${time(listing.checkedAt)}${listing.shipping ? ` · + ${listing.shipping.toLocaleString("sr-RS")} RSD delivery` : ""}`, listing }
	return { amount: fallback, label: priceLabel("catalogue"), listing: null }
}

function Picture({ src, category, name, size }: { src: string | null | undefined; category?: string; name: string; size: "lg" | "sm" }) {
	const Icon = ICON[category ?? ""] ?? Smartphone
	const box = size === "lg" ? "h-56 w-full sm:h-60 sm:w-60" : "h-24 w-full"
	if (src === undefined) return <div className={`${box} shrink-0 animate-pulse rounded-lg bg-[var(--paper)]`} aria-hidden="true" />
	if (!src) return <div className={`${box} grid shrink-0 place-items-center rounded-lg bg-[var(--paper)] text-[var(--muted)]`} aria-hidden="true"><Icon className={size === "lg" ? "size-16" : "size-8"} strokeWidth={1.25} /></div>
	return <img src={src} alt={name} loading="lazy" referrerPolicy="no-referrer" className={`${box} shrink-0 rounded-lg bg-[var(--sheet)] object-contain`} />
}

/** The best result for one thing to buy, then the next best products to swap to. */
export function BestPick({ wish, product, alternatives, listings, busy, sellFirst, onSwap }: {
	wish: Wish; product?: Product; alternatives: Product[]; listings: Listings; busy: boolean; sellFirst: string[]; onSwap: (p: Product) => void
}) {
	const loading = !!product && !(product.id in listings) && wish.priceSource === "catalogue"
	const main = priceOf(product ? listings[product.id] : null, wish.price, wish.priceSource !== "catalogue")
	const link = main.listing?.url ?? (wish.link.startsWith("https://") ? wish.link : "")

	return <article className="grid gap-6 border-b border-[var(--rule)] py-6">
		<div className="flex flex-col gap-6 sm:flex-row sm:items-center">
			<Picture src={product ? (product.id in listings ? listings[product.id]?.image ?? null : undefined) : null}category={product?.category} name={wish.name} size="lg" />
			<div className="grid min-w-0 gap-2">
				<h3 className="m-0 text-[clamp(28px,4vw,44px)] leading-tight font-extrabold tracking-[-0.02em] break-words">{wish.name}</h3>
				{loading
					? <span className="h-10 w-48 animate-pulse rounded bg-[var(--paper)]" aria-label="Looking up the price" />
					: <p className="m-0 font-mono text-[clamp(28px,3.4vw,40px)] font-bold tabular-nums"><NumberFlow value={main.amount} locales="sr-RS" /> RSD</p>}
				{!loading && <p className="m-0 text-sm text-[var(--muted)]">{main.label}</p>}
				{link && <a className="w-fit font-semibold" href={link} target="_blank" rel="noopener noreferrer nofollow">Open{main.listing ? ` at ${main.listing.shop}` : " offer"} ↗</a>}
				{sellFirst.map(name => <p key={name} className="m-0">Sell your {name} first.</p>)}
			</div>
		</div>
		{alternatives.length > 0 && <div className="grid gap-3">
			<h4 className="m-0 text-sm font-semibold text-[var(--muted)]">Next best</h4>
			<ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 lg:grid-cols-4">
				{alternatives.slice(0, 4).map(p => {
					const l = listings[p.id]
					const shown = priceOf(l, p.typicalPrice, false)
					return <li key={p.id}><button type="button" disabled={busy} onClick={() => onSwap(p)} title={`Swap to ${p.name}`}
						className="grid h-full w-full gap-2 rounded-lg border border-[var(--rule)] bg-[var(--sheet)] p-3 text-left transition-transform duration-150 ease-out hover:border-[var(--line-strong)] active:scale-[0.97] disabled:opacity-50">
						<Picture src={l === undefined ? undefined : l?.image ?? null} category={p.category} name={p.name} size="sm" />
						<span className="font-semibold">{p.name}</span>
						<span className="font-mono text-sm tabular-nums">{l === undefined ? "…" : `${shown.amount.toLocaleString("sr-RS")} RSD`}</span>
						{l !== undefined && <span className="text-xs text-[var(--muted)]">{shown.listing ? `at ${shown.listing.shop}` : "typical price (estimate)"}</span>}
					</button></li>
				})}
			</ul>
		</div>}
	</article>
}
