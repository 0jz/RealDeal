import NumberFlow from "@number-flow/react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Cpu, Gamepad2, Headphones, Laptop, Smartphone, Tablet, Tv, Watch, type LucideIcon } from "lucide-react"
import { useId, useState } from "react"
import type { Wish } from "../../src/finance/types"
import { SITE_NAMES, type ScoutListing, type ScoutResult } from "../../src/scout/types"
import { ScoutsRead } from "./ScoutsRead"

const ICON: Record<string, LucideIcon> = { phone: Smartphone, laptop: Laptop, tablet: Tablet, console: Gamepad2, tv: Tv, headphones: Headphones, gpu: Cpu, watch: Watch }
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
const rsd = (n: number) => n.toLocaleString("sr-RS")

function rangeText(minPrice?: number, maxPrice?: number): string {
	if (minPrice != null && maxPrice != null) return `${rsd(minPrice)}–${rsd(maxPrice)} RSD`
	if (maxPrice != null) return `do ${rsd(maxPrice)} RSD`
	if (minPrice != null) return `od ${rsd(minPrice)} RSD`
	return ""
}

function Picture({ src, category, name, size, loading }: { src: string | null | undefined; category?: string; name: string; size: "lg" | "sm"; loading?: boolean }) {
	const Icon = ICON[category ?? ""] ?? Smartphone
	const box = size === "lg" ? "h-56 w-full sm:h-60 sm:w-60" : "h-24 w-full"
	if (loading || src === undefined) return <div className={`${box} shrink-0 animate-pulse rounded-lg bg-[var(--paper)]`} aria-hidden="true" />
	if (!src) return <div className={`${box} grid shrink-0 place-items-center rounded-lg bg-[var(--paper)] text-[var(--muted)]`} aria-hidden="true"><Icon className={size === "lg" ? "size-16" : "size-8"} strokeWidth={1.25} /></div>
	return <PictureImg src={src} name={name} box={box} />
}

function PictureImg({ src, name, box }: { src: string; name: string; box: string }) {
	const [broken, setBroken] = useState(false)
	if (broken) return <div className={`${box} grid shrink-0 place-items-center rounded-lg bg-[var(--paper)] text-[var(--muted)]`} aria-hidden="true"><Smartphone className={box.includes("h-56") ? "size-16" : "size-8"} strokeWidth={1.25} /></div>
	return <img src={src} alt={name} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={`${box} shrink-0 rounded-lg bg-[var(--sheet)] object-contain`} />
}

function listingLabel(l: ScoutListing): string {
	let out = `at ${l.shop} · checked ${time(l.checkedAt)}`
	if ((l.delivery ?? 0) > 0) out += ` · + ${rsd(l.delivery ?? 0)} RSD delivery`
	if (l.verified) out += " · verified"
	return out
}

function ListingCard({ listing, size, busy, onUse }: { listing: ScoutListing; size: "next" | "mention"; busy: boolean; onUse: (l: ScoutListing) => void }) {
	const small = size === "mention"
	return <div className="grid h-full gap-2 rounded-lg border border-[var(--rule)] bg-[var(--sheet)] p-3">
		<Picture src={listing.image ?? null} name={listing.title} size="sm" />
		<p className={`m-0 font-semibold ${small ? "text-sm" : ""} [display:-webkit-box] overflow-hidden [-webkit-box-orient:vertical] [-webkit-line-clamp:2]`}>{listing.title}</p>
		<p className="m-0 font-mono text-sm tabular-nums">{rsd(listing.price)} RSD</p>
		<p className="m-0 text-xs text-[var(--muted)]">{`at ${listing.shop} · checked ${time(listing.checkedAt)}`}</p>
		{!small && <p className="m-0 text-xs text-[var(--muted)]">{listing.reason}</p>}
		<div className="mt-auto flex flex-wrap gap-2 pt-1">
			<a className="text-xs font-semibold" href={listing.url} target="_blank" rel="noopener noreferrer nofollow">Open ↗</a>
			<button type="button" disabled={busy} onClick={() => onUse(listing)} className="border-0 bg-transparent p-0 text-xs font-semibold text-[var(--ink)] underline decoration-[var(--rule)] underline-offset-2 disabled:opacity-50">Use this instead</button>
		</div>
	</div>
}

function siteStatusLine(scout: ScoutResult, site: keyof ScoutResult["sites"]): string {
	const report = scout.sites[site]
	const shop = SITE_NAMES[site]
	if (!report) return `${shop}: not checked`
	if (report.status === "ok") return report.found > 0 ? `${shop}: nothing matched well enough` : `${shop}: no matches`
	if (report.status === "blocked") return `${shop}: blocked the request`
	if (report.status === "off") return `${shop}: not checked${report.note ? ` (${report.note})` : ""}`
	if (report.status === "skipped") return `${shop}: not sold here`
	return `${shop}: couldn't finish`
}

/** The best result for one thing to buy, then the next best listings to swap to. */
export function BestPick(props: {
	wish: Wish
	scout?: ScoutResult
	scouting: boolean
	busy: boolean
	sellFirst: string[]
	onUse: (l: ScoutListing) => void
}) {
	const { wish, scout, scouting, busy, sellFirst, onUse } = props
	const [expanded, setExpanded] = useState(false)
	const reduce = useReducedMotion()
	const mentionsId = useId()
	const best = scout?.best ?? null
	const next = scout?.next ?? []
	const mentions = scout?.mentions ?? []
	const finished = !!scout && scout.finishedAt !== ""
	const totalMore = next.length + mentions.length
	const range = rangeText(scout?.minPrice, scout?.maxPrice)

	if (scouting && !best) {
		return <article className="grid gap-6 border-b border-[var(--rule)] py-6">
			<div className="flex flex-col gap-6 sm:flex-row sm:items-center">
				<Picture src={undefined} name={wish.name} size="lg" loading />
				<div className="grid min-w-0 gap-2">
					<h3 className="m-0 text-[clamp(28px,4vw,44px)] leading-tight font-extrabold tracking-[-0.02em] break-words">{wish.name}</h3>
					<span className="h-10 w-48 animate-pulse rounded bg-[var(--paper)]" aria-label="Scouting" />
					<p className="m-0 text-sm text-[var(--muted)]">Scouts are checking the shops…</p>
				</div>
			</div>
			<ScoutsRead scout={scout} />
		</article>
	}

	if (finished && !best) {
		return <article className="grid gap-6 border-b border-[var(--rule)] py-6">
			<div className="flex flex-col gap-6 sm:flex-row sm:items-center">
				<Picture src={null} name={wish.name} size="lg" />
				<div className="grid min-w-0 gap-2">
					<h3 className="m-0 text-[clamp(28px,4vw,44px)] leading-tight font-extrabold tracking-[-0.02em] break-words">{wish.name}</h3>
					<p className="m-0 text-sm text-[var(--muted)]">No listing found in the shops we checked for {wish.name}{range ? `, ${range}` : ""}.</p>
					{scout && <ul className="m-0 grid list-none gap-1 p-0 text-sm text-[var(--muted)]">
						{(Object.keys(SITE_NAMES) as Array<keyof typeof SITE_NAMES>).map(site => <li key={site}>{siteStatusLine(scout, site)}</li>)}
					</ul>}
					{sellFirst.map(name => <p key={name} className="m-0">Sell your {name} first.</p>)}
				</div>
			</div>
			<ScoutsRead scout={scout} />
		</article>
	}

	if (!best) {
		return <article className="grid gap-6 border-b border-[var(--rule)] py-6">
			<div className="flex flex-col gap-6 sm:flex-row sm:items-center">
				<Picture src={undefined} name={wish.name} size="lg" loading />
				<div className="grid min-w-0 gap-2">
					<h3 className="m-0 text-[clamp(28px,4vw,44px)] leading-tight font-extrabold tracking-[-0.02em] break-words">{wish.name}</h3>
					<p className="m-0 text-sm text-[var(--muted)]">Waiting for scouts…</p>
				</div>
			</div>
			<ScoutsRead scout={scout} />
		</article>
	}

	const showExpand = mentions.length > 0
	const showLess = totalMore > 0 && totalMore <= 8 && !showExpand && next.length > 0
	const noNext = finished && next.length === 0 && mentions.length === 0

	return <article className="grid gap-6 border-b border-[var(--rule)] py-6">
		<div className="flex flex-col gap-6 sm:flex-row sm:items-center">
			<Picture src={best.image ?? null} name={best.title} size="lg" />
			<div className="grid min-w-0 gap-2">
				<h3 className="m-0 text-[clamp(28px,4vw,44px)] leading-tight font-extrabold tracking-[-0.02em] break-words [display:-webkit-box] overflow-hidden [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">{best.title}</h3>
				<p className="m-0 text-sm text-[var(--muted)]">for: {scout?.query || wish.name}{range ? `, ${range}` : ""}</p>
				<p className="m-0 font-mono text-[clamp(28px,3.4vw,40px)] font-bold tabular-nums"><NumberFlow value={best.price} locales="sr-RS" /> RSD</p>
				<p className="m-0 text-sm text-[var(--muted)]">{listingLabel(best)}</p>
				<a className="w-fit font-semibold" href={best.url} target="_blank" rel="noopener noreferrer nofollow">Open this listing ↗</a>
				<p className="m-0 text-sm text-[var(--muted)]">{best.reason}</p>
				{sellFirst.map(name => <p key={name} className="m-0">Sell your {name} first.</p>)}
			</div>
		</div>

		{next.length > 0 && <div className="grid gap-3">
			<h4 className="m-0 text-sm font-semibold text-[var(--muted)]">Next best</h4>
			<div className="grid gap-3 sm:grid-cols-2">
				{next.map(l => <ListingCard key={l.url} listing={l} size="next" busy={busy} onUse={onUse} />)}
			</div>
		</div>}

		{showExpand && !expanded && <button type="button" aria-expanded={false} aria-controls={mentionsId} onClick={() => setExpanded(true)}
			className="mx-auto border-0 bg-transparent p-0 text-sm font-semibold text-[var(--muted)] underline decoration-[var(--rule)] underline-offset-2">Expand more ({mentions.length})</button>}

		<AnimatePresence initial={false}>
			{showExpand && expanded && <motion.div id={mentionsId} initial={reduce ? false : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: "easeOut" }} className="overflow-hidden">
				<div className="grid gap-3">
					<h4 className="m-0 text-sm font-semibold text-[var(--muted)]">Honorable mentions</h4>
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
						{mentions.slice(0, 3).map((l, i) => <motion.div key={l.url} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: "easeOut", delay: reduce ? 0 : i * 0.03 }}>
							<ListingCard listing={l} size="mention" busy={busy} onUse={onUse} />
						</motion.div>)}
					</div>
					{mentions.length > 3 && <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						{mentions.slice(3, 7).map((l, i) => <motion.div key={l.url} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: "easeOut", delay: reduce ? 0 : (i + 3) * 0.03 }}>
							<ListingCard listing={l} size="mention" busy={busy} onUse={onUse} />
						</motion.div>)}
					</div>}
					<button type="button" aria-expanded={true} aria-controls={mentionsId} onClick={() => setExpanded(false)}
						className="mx-auto border-0 bg-transparent p-0 text-sm font-semibold text-[var(--muted)] underline decoration-[var(--rule)] underline-offset-2">Show less</button>
				</div>
			</motion.div>}
		</AnimatePresence>

		{showLess && <p className="m-0 text-sm text-[var(--muted)]">Only {totalMore} more listings matched.</p>}
		{noNext && <p className="m-0 text-sm text-[var(--muted)]">No other listings matched.</p>}

		<ScoutsRead scout={scout} />
	</article>
}
