import assert from "node:assert/strict"
import { test } from "node:test"
import { budgetBands, groupByBudget } from "./budget"

test("100k bands include each boundary exactly once and exclude over-budget prices", () => {
	const prices = [0, 1, 33333, 33334, 66666, 66667, 100000, 100001, NaN, Infinity]
	assert.deepEqual(groupByBudget(prices, 100000, p => p).map(g => g.items), [[1, 33333], [33334, 66666], [66667, 100000]])
})

test("empty and very small budgets retain three explicit tiers, invalid caps have none", () => {
	assert.deepEqual(groupByBudget([1, 2], 2, p => p).map(g => g.items), [[], [1], [2]])
	assert.deepEqual(groupByBudget([1], 0, p => p).map(g => g.items), [[], [], []])
	for (const invalid of [-1, NaN, Infinity, 1.5]) assert.deepEqual(budgetBands(invalid), [])
})
