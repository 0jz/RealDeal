import { customerFetch, isBackedOff } from "../sources/customer"
import { ScoutBlocked } from "./types"

/** A failed request is not an empty catalogue. Preserve this distinction for the UI. */
export function comparisonReader(fetchPage = customerFetch, backedOff = isBackedOff) {
	return async (url: string, opts: { fresh?: boolean } = {}): Promise<string> => {
		const html = await fetchPage(url, opts)
		if (html !== null) return html
		if (backedOff(url)) throw new ScoutBlocked(`${new URL(url).hostname} blocked the request; waiting for access to recover`)
		throw new Error(`Could not read ${url}`)
	}
}

export const comparisonFetch = comparisonReader()
