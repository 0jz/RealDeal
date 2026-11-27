/** Integer RSD bands. Boundaries belong to exactly one tier. */
export type BudgetTier = "budget" | "mid" | "top"
export type BudgetBand = { tier: BudgetTier; min: number; max: number }
export type BudgetGroup<T> = BudgetBand & { items: T[] }

export function budgetBands(budget: number): BudgetBand[] {
	if (!Number.isSafeInteger(budget) || budget < 0) return []
	const third = Math.floor(budget / 3)
	const second = Math.floor(budget * 2 / 3)
	return [
		{ tier: "budget", min: 1, max: third },
		{ tier: "mid", min: third + 1, max: second },
		{ tier: "top", min: second + 1, max: budget },
	]
}

export const inBand = (total: number, band: BudgetBand): boolean =>
	Number.isFinite(total) && total >= band.min && total <= band.max

/** Input is already ranked. Empty bands are retained; no out-of-band substitutes. */
export function groupByBudget<T>(items: T[], budget: number, total: (item: T) => number, limit = 3): BudgetGroup<T>[] {
	return budgetBands(budget).map(band => ({ ...band, items: items.filter(item => inBand(total(item), band)).slice(0, limit) }))
}
