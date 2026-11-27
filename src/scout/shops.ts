// The real shop scouts and the VerifyAgent's live re-read. Office Shoes is off in v1 (its search needs a POST).

import { politeContentType, politeFetch } from "../sources/http"
import { createAnanasScout } from "./ananas"
import { createGigatronScout } from "./gigatron"
import { OFFICESHOES_OFF_NOTE } from "./officeshoes"
import { createTehnomediaScout } from "./tehnomedia"
import type { ScoutSite, ShopScout } from "./types"
import type { VerifyDeps } from "./verify"

export function shopDeps(): { scouts: ShopScout[]; offNotes: Partial<Record<ScoutSite, string>>; verify: VerifyDeps } {
	const scouts = [createTehnomediaScout(), createAnanasScout(), createGigatronScout()]
	// Verification must see the live page, not the fetch cache.
	const fresh = (url: string) => politeFetch(url, { fresh: true })
	const rereaders = new Map<ScoutSite, ShopScout>([createTehnomediaScout(fresh), createAnanasScout(fresh), createGigatronScout(fresh)].map(s => [s.site, s]))
	return {
		scouts,
		offNotes: { officeshoes: OFFICESHOES_OFF_NOTE },
		verify: {
			reread: async l => { const s = rereaders.get(l.site); return s ? s.read(l.url) : null },
			contentType: politeContentType,
		},
	}
}
