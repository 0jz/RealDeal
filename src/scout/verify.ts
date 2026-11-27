// VerifyAgent: re-reads each shown listing before the plan keeps it. Deterministic, no LLM.
// The reread and the image check are injected, so tests run without the network.

import type { ScoutCandidate, ScoutListing } from "./types"

export type VerifyDeps = {
	/** Re-reads the listing's page with its shop's parser. */
	reread: (l: ScoutListing) => Promise<ScoutCandidate | null>
	contentType: (url: string) => Promise<string | null>
	now?: () => string
}

export type VerifyOutcome = { ok: true; listing: ScoutListing } | { ok: false; listing: ScoutListing; why: string }

const PAGE_GONE = "page no longer loads"

async function imageOk(url: string, contentType: VerifyDeps["contentType"]): Promise<boolean> {
	try {
		return ((await contentType(url)) ?? "").startsWith("image/")
	} catch {
		return false
	}
}

export async function verifyListing(l: ScoutListing, deps: VerifyDeps): Promise<VerifyOutcome> {
	let fresh: ScoutCandidate | null
	try {
		fresh = await deps.reread(l)
	} catch {
		fresh = null
	}
	if (!fresh) return { ok: false, listing: l, why: PAGE_GONE }
	if (fresh.inStock === false) return { ok: false, listing: l, why: "out of stock" }
	if (fresh.delivery !== l.delivery) return { ok: false, listing: l, why: "delivery cost changed; check prices again" }
	if (fresh.price !== l.price) return { ok: false, listing: l, why: `price changed from ${l.price} to ${fresh.price} RSD` }

	// A broken picture is dropped, never swapped for another listing's picture.
	const image = l.image !== null && (await imageOk(l.image, deps.contentType)) ? l.image : null
	return {
		ok: true,
		listing: { ...l, image, verified: true, checkedAt: deps.now?.() ?? fresh.checkedAt },
	}
}

/** Verifies ranked listings in parallel batches, one per open slot, until `slots` pass or the list ends.
 * Rank order is kept. Page rereads still queue per shop in politeFetch; pictures (another host) and other shops overlap.
 * Returns kept (verified: true, fresh checkedAt) and dropped with why. */
export async function verifyRanked(
	ranked: ScoutListing[],
	deps: VerifyDeps,
	slots = 10,
	isCancelled?: () => boolean,
): Promise<{ kept: ScoutListing[]; dropped: VerifyOutcome[] }> {
	const kept: ScoutListing[] = []
	const dropped: VerifyOutcome[] = []
	let next = 0
	while (kept.length < slots && next < ranked.length && !isCancelled?.()) {
		const batch = ranked.slice(next, next + slots - kept.length)
		next += batch.length
		for (const out of await Promise.all(batch.map(l => verifyListing(l, deps)))) {
			if (out.ok) kept.push(out.listing)
			else dropped.push(out)
		}
	}
	return { kept, dropped }
}
