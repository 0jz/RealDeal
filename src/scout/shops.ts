// Live shop scouts and fresh verification. Office Shoes and Gigatron remain off.

import { comparisonFetch } from "./comparison"
import { politeContentType, politeFetch } from "../sources/http"
import { createAnanasScout } from "./ananas"
import { createCenotekaScout } from "./cenoteka"
import { createEponudaScout } from "./eponuda"
import { createGigatronScout } from "./gigatron"
import { OFFICESHOES_OFF_NOTE } from "./officeshoes"
import { createTehnomediaScout } from "./tehnomedia"
import type { ScoutSite, ShopScout } from "./types"
import type { VerifyDeps } from "./verify"

const OFF_NOTE = "off in v2: the planner scouts Tehnomedia, Ananas, eponuda and Cenoteka"

export function shopDeps(): { scouts: ShopScout[]; offNotes: Partial<Record<ScoutSite, string>>; verify: VerifyDeps } {
	const scouts = [createTehnomediaScout(), createAnanasScout(), createEponudaScout(), createCenotekaScout()]
	// Verification must see the live page, not the fetch cache.
	const fresh = (url: string) => politeFetch(url, { fresh: true })
	const freshCustomer = (url: string) => comparisonFetch(url, { fresh: true })
	const rereaders = new Map<ScoutSite, ShopScout>([
		createTehnomediaScout(fresh),
		createAnanasScout(fresh),
		createGigatronScout(fresh),
		createEponudaScout(freshCustomer),
		createCenotekaScout(freshCustomer),
	].map(s => [s.site, s]))
	return {
		scouts,
		offNotes: { officeshoes: OFFICESHOES_OFF_NOTE, gigatron: OFF_NOTE },
		verify: {
			reread: async l => { const s = rereaders.get(l.site); return s ? s.read(l.url) : null },
			contentType: politeContentType,
		},
	}
}
