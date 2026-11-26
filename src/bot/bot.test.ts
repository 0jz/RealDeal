// Drives the real bot and the real search engine without Telegram: Bot API calls are
// answered by a fake transformer and recorded, and updates are fed in by hand.

import assert from "node:assert/strict"
import { after, test } from "node:test"
import type { Update } from "grammy/types"
import { startEngine } from "../search/agents"
import { createBot } from "./bot"

startEngine()

type Call = { method: string; payload: Record<string, unknown>; sentId?: number }
const calls: Call[] = []
let messageId = 100

const bot = createBot("123:fake")
bot.botInfo = {
	id: 123,
	is_bot: true,
	first_name: "RealDeal",
	username: "realdeal_test_bot",
	can_join_groups: false,
	can_read_all_group_messages: false,
	supports_inline_queries: false,
	can_connect_to_business: false,
	has_main_web_app: false,
} as typeof bot.botInfo
bot.api.config.use(async (_prev, method, payload) => {
	const sentId = method === "sendMessage" ? ++messageId : undefined
	calls.push({ method, payload: payload as Record<string, unknown>, sentId })
	const result = sentId ? { message_id: sentId, date: 0, chat: { id: 1, type: "private" }, text: "" } : true
	return { ok: true, result } as never
})

let updateId = 0
function send(text: string) {
	const command = /^\/\w+/.exec(text)
	const update = {
		update_id: ++updateId,
		message: {
			message_id: updateId,
			date: 0,
			chat: { id: 1, type: "private", first_name: "T" },
			from: { id: 1, is_bot: false, first_name: "T" },
			text,
			...(command ? { entities: [{ type: "bot_command", offset: 0, length: command[0].length }] } : {}),
		},
	} as Update
	return bot.handleUpdate(update)
}

/** Edits of the message the bot sent in reply to the update fed in after call index `from`. */
function editsOfReply(from: number): string[] {
	const id = calls.slice(from).find((c) => c.sentId)?.sentId
	if (!id) return []
	return calls.filter((c) => c.method === "editMessageText" && c.payload.message_id === id).map((c) => String(c.payload.text))
}

const texts = (method: string) => calls.filter((c) => c.method === method).map((c) => String(c.payload.text))

async function until(check: () => boolean, ms = 20_000) {
	const end = Date.now() + ms
	while (!check()) {
		if (Date.now() > end) throw new Error("timed out")
		await new Promise((r) => setTimeout(r, 100))
	}
}

after(() => send("/stop"))

test("/start replies with the command list", async () => {
	await send("/start")
	const help = texts("sendMessage").at(-1)!
	for (const cmd of ["/trazi", "/budzet", "/prodaj", "/prati"]) assert.ok(help.includes(cmd), cmd)
})

test("/trazi sends a message and edits it with misspelled matches", async () => {
	await send("/trazi ajfon 15 pro")
	await until(() => texts("editMessageText").some((t) => t.includes("iPhone 15 Pro")))
})

test("/budzet never shows a price over the budget, in picks or in listings", async () => {
	const before = calls.length
	await send("/budzet 60000 telefon")
	await until(() => editsOfReply(before).some((t) => /gotovo/.test(t)))
	const last = editsOfReply(before).at(-1)!
	assert.match(last, /Najbolje za 60\.000 RSD/)
	// Every price in the message except the budget itself and market-price hints.
	const shown = last.replace(/Najbolje za [\d.]+ RSD/, "").replace(/tržište ~[\d.]+ RSD/g, "").replace(/ostaje [\d.]+ RSD/g, "")
	const prices = [...shown.matchAll(/(\d{1,3}(?:\.\d{3})+) RSD/g)].map((m) => Number(m[1].replace(/\./g, "")))
	assert.ok(prices.length > 0)
	assert.ok(prices.every((p) => p <= 60_000), `prices: ${prices.join(", ")}`)
})

test("/prodaj answers with a price range", async () => {
	const before = calls.length
	await send("/prodaj iphone 13 128GB polovan")
	await until(() => editsOfReply(before).some((t) => /iPhone 13/.test(t) && /Brza prodaja: <b>[\d.]+ RSD/.test(t)))
})

test("/prati alerts on listings under the price, /stop ends it", async () => {
	const before = calls.length
	await send("/prati ps5 60000")
	assert.match(texts("sendMessage").at(-1)!, /Pratim/)
	await until(() => calls.slice(before).filter((c) => c.method === "sendMessage").length >= 2)
	await send("/stop")
	assert.match(texts("sendMessage").at(-1)!, /Prekinuto praćenje \(1\)/)
})

test("an unknown command gets a hint, not a crash", async () => {
	await send("/nesto")
	assert.match(texts("sendMessage").at(-1)!, /Ne znam tu komandu/)
})
