import assert from "node:assert/strict"
import { test } from "node:test"
import { Session } from "../runtime"
import { SOURCES } from "../sources"
import { search, subscribe, type SearchView } from "./engine"

function finished(id: string): Promise<SearchView> {
	return new Promise((resolve, reject) => {
		let off = () => {}
		const timer = setTimeout(() => { off(); reject(new Error("search did not finish")) }, 5000)
		off = subscribe(id, view => {
			if (view.done) { clearTimeout(timer); queueMicrotask(off); resolve(view) }
		})
	})
}

test("finished source pages do not complete a search before the last listing is processed", () => {
	const s = new Session("pending", { mode: "search", query: "phone" })
	s.plan = { searchId: s.id, terms: ["phone"], productIds: [], category: "phone", storageGb: null }
	s.sources.set("test", { id: "test", name: "Test", live: false, state: "done", pages: 1, found: 1 })
	s.seen.add("pending-listing")
	assert.equal(s.done, false)
	s.rejected++
	assert.equal(s.done, true)
})

test("a failed source finishes and other sources still return correctly sized devices", async () => {
	const source = SOURCES[0]
	const original = source.search
	source.search = async () => { throw new Error("test source unavailable") }
	try {
		const view = await finished(search({ mode: "search", query: "iPhone 13 128GB" }))
		assert.ok(view.sources.every(s => s.state === "done"))
		const rows = view.groups.flatMap(g => g.rows)
		assert.ok(rows.length > 0)
		assert.ok(rows.every(r => r.storageGb === 128))
	} finally { source.search = original }
})
