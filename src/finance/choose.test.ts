import assert from "node:assert/strict"
import { test } from "node:test"
import { CATALOGUE, PRODUCTS, productName } from "../search/catalogue"
import { choose, wishesFromWants } from "./choose"
import { assessOffers, emptyLedger, estimateResale, matchProduct, optimize } from "./model"
import type { Goal, Intent } from "./types"

const intent = (wants: Intent["wants"], sells: Intent["sells"] = []): Intent => ({ wants, sells })
const planOf = (goal: Goal) => optimize(goal, emptyLedger(), assessOffers(goal), estimateResale(goal))
const msrpOf = (goal: Goal) => PRODUCTS.get(matchProduct(goal.wishes[0].name)!)!.msrp
const phone: Intent["wants"][number] = { text: "phone", category: "phone", priority: 1 }
const consoleWant: Intent["wants"][number] = { text: "console", category: "console", priority: 2 }

test("phone + console at 160k: picks the highest-score pair that fits", () => {
	const budget = 160000
	const { goal } = choose(intent([phone, consoleWant]), budget)
	const phones = CATALOGUE.filter(p => p.category === "phone")
	const consoles = CATALOGUE.filter(p => p.category === "console")
	const expected = phones
		.flatMap(a => consoles.filter(b => a.msrp + b.msrp <= budget).map(b => [a, b] as const))
		.sort((x, y) => (y[0].score + y[1].score) - (x[0].score + x[1].score) || (x[0].msrp + x[1].msrp) - (y[0].msrp + y[1].msrp) || (x[0].id + x[1].id).localeCompare(y[0].id + y[1].id))[0]
	assert.deepEqual(goal.wishes.map(w => w.name), [productName(expected[0].id), productName(expected[1].id)])
	assert.equal(planOf(goal).selectedOffers.length, 2)
})

test("phone + console at 60k: the phone is covered, the console waits", () => {
	const { goal } = choose(intent([phone, consoleWant]), 60000)
	const plan = planOf(goal)
	assert.ok(plan.selectedOffers.includes("w1"))
	assert.ok(!plan.selectedOffers.includes("w2"))
})

test("selling the old phone makes a better phone affordable", () => {
	const without = choose(intent([phone]), 70000)
	const withSale = choose(intent([phone], [{ text: "iPhone 13", productId: "iphone-13", condition: "good", expectedPrice: 40000 }]), 70000)
	assert.ok(msrpOf(withSale.goal) > msrpOf(without.goal))
})

test("the same input gives the same plan", () => {
	const input = intent([phone, consoleWant], [{ text: "iPhone 13", productId: "iphone-13", condition: "good", expectedPrice: 40000 }])
	assert.deepEqual(choose(input, 120000), choose(input, 120000))
})

test("budget sweep: never throws and keeps the reserve", () => {
	for (let budget = 0; budget <= 200000; budget += 5000) {
		const { goal } = choose(intent([phone], [{ text: "iPhone 13", productId: "iphone-13", condition: "good", expectedPrice: 40000 }]), budget)
		assert.ok(planOf(goal).projectedRemaining >= goal.reserve, `budget ${budget}`)
	}
})

test("a fixed product keeps its product, price and price source", () => {
	const { goal } = choose(intent([{ text: "iPhone 15", productId: "iphone-15", price: 85000, priority: 1 }]), 100000)
	assert.equal(goal.wishes[0].name, productName("iphone-15"))
	assert.equal(goal.wishes[0].price, 85000)
	assert.equal(goal.wishes[0].priceSource, "you")
})

test("an empty prompt throws and unmatched wants are reported", () => {
	assert.throws(() => choose(intent([]), 100000), /Nothing to buy/)
	const { goal, uncovered } = choose(intent([phone, { text: "grandma's bike", priority: 2 }]), 100000)
	assert.deepEqual(uncovered, ["grandma's bike"])
	assert.equal(goal.wishes.length, 1)
})


test("listing search inherits the total budget minus reserve and caps explicit item limits", () => {
	const { wants } = wishesFromWants({ ...intent([phone, { text: "laptop", priority: 2, maxPrice: 150000 }]), reserve: 10000 }, 100000)
	assert.equal(wants.w1.maxPrice, 90000)
	assert.equal(wants.w2.maxPrice, 90000)
	assert.equal(wishesFromWants(intent([{ ...phone, maxPrice: 30000, minPrice: 15000 }]), 100000).wants.w1.maxPrice, 30000)
	assert.equal(wishesFromWants(intent([phone]), 0).wants.w1.maxPrice, 0)
})
