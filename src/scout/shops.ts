// The planner's live shop scouts (Ananas, eponuda, Cenoteka) and the VerifyAgent's fresh re-read.
// Tehnomedia, Office Shoes and Gigatron stay registered but off in v2.

import { customerFetch } from "../sources/customer"
import { politeContentType, politeFetch } from "../sources/http"
import { createAnanasScout } from "./ananas"
import { createCenotekaScout } from "./cenoteka"
import { createEponudaScout } from "./eponuda"
import { createGigatronScout } from "./gigatron"
import { OFFICESHOES_OFF_NOTE } from "./officeshoes"
import { createTehnomediaScout } from "./tehnomedia"
import type { ScoutSite, ShopScout } from "./types"
import type { VerifyDeps } from "./verify"

const OFF_NOTE = "off in v2: the planner scouts eponuda, Cenoteka and Ananas"

export function shopDeps(): { scouts: ShopScout[]; offNotes: Partial<Record<ScoutSite, string>>; verify: VerifyDeps } {
	const scouts = [createAnanasScout(), createEponudaScout(), createCenotekaScout()]
	// Verification must see the live page, not the fetch cache.
	const fresh = (url: string) => politeFetch(url, { fresh: true })
	const freshCustomer = (url: string) => customerFetch(url, { fresh: true })
	const rereaders = new Map<ScoutSite, ShopScout>([
		createTehnomediaScout(fresh),
		createAnanasScout(fresh),
		createGigatronScout(fresh),
		createEponudaScout(freshCustomer),
		createCenotekaScout(freshCustomer),
	].map(s => [s.site, s]))
	return {
		scouts,
		offNotes: { tehnomedia: OFF_NOTE, officeshoes: OFFICESHOES_OFF_NOTE, gigatron: OFF_NOTE },
		verify: {
			reread: async l => { const s = rereaders.get(l.site); return s ? s.read(l.url) : null },
			contentType: politeContentType,
		},
	}
}
