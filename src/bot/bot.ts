// Telegram front end. Thin: parses commands, calls the search engine, and shows
// its views as one message that is edited while the search runs.

import { Bot, GrammyError, type Context } from "grammy"
import { cancel, getView, search, subscribe } from "../search/engine"
import type { ResultRow, SearchRequest, SearchView } from "../search/types"
import { esc, formatPrice, formatView, formatWatchAlert, helpText, parseCommand, splitTrailingAmount } from "./format"

const EDIT_THROTTLE_MS = 1200
const FOLLOW_MAX_MS = 60_000
const WATCH_EVERY_MS = 10 * 60_000
const WATCH_RUN_MAX_MS = 5 * 60_000
const MAX_WATCHES_PER_CHAT = 5

const OPTS = { parse_mode: "HTML", link_preview_options: { is_disabled: true } } as const

type Watch = { query: string; maxPrice: number; seen: Set<string>; timer?: NodeJS.Timeout; running: boolean }

/** Resolves with the search's final view, or its latest view after WATCH_RUN_MAX_MS. */
function settle(searchId: string): Promise<SearchView | null> {
	return new Promise((resolve) => {
		let off: (() => void) | undefined
		let finished = false
		const finish = (view: SearchView | null) => {
			if (finished) return
			finished = true
			clearTimeout(deadline)
			off?.()
			cancel(searchId)
			resolve(view)
		}
		const deadline = setTimeout(() => finish(getView(searchId)), WATCH_RUN_MAX_MS)
		off = subscribe(searchId, (view) => {
			if (view.done) finish(view)
		})
		if (finished) off()
	})
}

function isNotModified(err: unknown): boolean {
	return err instanceof GrammyError && err.description.includes("message is not modified")
}

export function createBot(token: string): Bot {
	const bot = new Bot(token)
	const watches = new Map<number, Watch[]>()

	bot.catch((err) => console.error("[bot] update failed:", err.error))

	/** Keeps one message in sync with a running search: edits at most every 1.2 s, always the final view. */
	function follow(chatId: number, messageId: number, searchId: string, initialText: string) {
		let latest: SearchView | null = null
		let lastText = initialText
		let lastEditAt = 0
		let throttle: NodeJS.Timeout | undefined
		let finished = false
		let unsubscribe: (() => void) | undefined
		let queue: Promise<void> = Promise.resolve()

		const finish = () => {
			if (finished) return
			finished = true
			clearTimeout(throttle)
			clearTimeout(deadline)
			unsubscribe?.()
			cancel(searchId)
		}

		const edit = async () => {
			const view = latest
			if (!view || finished) return
			const text = formatView(view)
			if (text !== lastText) {
				lastText = text
				lastEditAt = Date.now()
				try {
					await bot.api.editMessageText(chatId, messageId, text, OPTS)
				} catch (err) {
					if (!isNotModified(err)) console.error("[bot] edit failed:", err)
				}
			}
			if (view.done) finish()
		}

		const enqueue = () => {
			queue = queue.then(edit)
		}

		const schedule = () => {
			if (finished) return
			if (latest?.done) {
				clearTimeout(throttle)
				throttle = undefined
				enqueue()
				return
			}
			if (throttle) return
			const wait = Math.max(0, EDIT_THROTTLE_MS - (Date.now() - lastEditAt))
			throttle = setTimeout(() => {
				throttle = undefined
				enqueue()
			}, wait)
		}

		const deadline = setTimeout(() => {
			queue = queue.then(edit).then(finish)
		}, FOLLOW_MAX_MS)

		unsubscribe = subscribe(searchId, (view) => {
			latest = view
			schedule()
		})
	}

	async function runSearch(ctx: Context, request: SearchRequest) {
		const chatId = ctx.chat?.id
		if (chatId === undefined) return
		await ctx.replyWithChatAction("typing").catch(() => undefined)
		const searchId = search(request)
		const first = getView(searchId)
		const text = first ? formatView(first) : "Tražim…"
		const sent = await ctx.reply(text, OPTS)
		follow(chatId, sent.message_id, searchId, text)
	}

	async function checkWatch(chatId: number, watch: Watch) {
		if (watch.running) return
		watch.running = true
		try {
			const view = await settle(search({ mode: "search", query: watch.query, origin: "telegram" }))
			if (!view || !watches.get(chatId)?.includes(watch)) return
			const fresh: ResultRow[] = []
			for (const row of view.groups.flatMap((g) => g.rows)) {
				if (row.total <= watch.maxPrice && !watch.seen.has(row.key)) {
					watch.seen.add(row.key)
					fresh.push(row)
				}
			}
			if (fresh.length > 0) {
				await bot.api.sendMessage(chatId, formatWatchAlert(watch.query, watch.maxPrice, fresh), OPTS)
			}
		} catch (err) {
			console.error("[bot] watch failed:", err)
		} finally {
			watch.running = false
		}
	}

	async function handleWatch(ctx: Context) {
		const chatId = ctx.chat?.id
		if (chatId === undefined) return
		const args = String(ctx.match ?? "").trim()
		const list = watches.get(chatId) ?? []

		if (!args) {
			if (list.length === 0) {
				await ctx.reply("Nema praćenja. Primer: <code>/prati ps5 60000</code>", OPTS)
				return
			}
			const lines = list.map((w, i) => `${i + 1}. ${esc(w.query)} ispod ${formatPrice(w.maxPrice)}`)
			await ctx.reply(`<b>Praćenja:</b>\n${lines.join("\n")}\n\nSva prekidaš sa /stop.`, OPTS)
			return
		}

		const parsed = splitTrailingAmount(args)
		if (!parsed || parsed.amount === null) {
			await ctx.reply("Upiši upit pa maksimalnu cenu, npr. <code>/prati iphone 15 pro 80k</code>", OPTS)
			return
		}
		if (list.length >= MAX_WATCHES_PER_CHAT) {
			await ctx.reply(`Možeš da pratiš najviše ${MAX_WATCHES_PER_CHAT} stvari. Prekini neku sa /stop.`, OPTS)
			return
		}

		const watch: Watch = { query: parsed.query, maxPrice: parsed.amount, seen: new Set(), running: false }
		watch.timer = setInterval(() => void checkWatch(chatId, watch), WATCH_EVERY_MS)
		watches.set(chatId, [...list, watch])
		await ctx.reply(
			`Pratim <b>${esc(watch.query)}</b> ispod ${formatPrice(watch.maxPrice)}. Proveravam na 10 minuta.`,
			OPTS,
		)
		void checkWatch(chatId, watch)
	}

	async function handleStop(ctx: Context) {
		const chatId = ctx.chat?.id
		if (chatId === undefined) return
		const list = watches.get(chatId) ?? []
		for (const watch of list) clearInterval(watch.timer)
		watches.delete(chatId)
		await ctx.reply(list.length ? `Prekinuto praćenje (${list.length}).` : "Nema aktivnih praćenja.", OPTS)
	}

	async function handleText(ctx: Context) {
		const parsed = parseCommand(ctx.message?.text ?? "")
		if (parsed === null) {
			await ctx.reply(helpText(), OPTS)
			return
		}
		if ("error" in parsed) {
			await ctx.reply(esc(parsed.error), OPTS)
			return
		}
		await runSearch(ctx, parsed)
	}

	const guarded = (handler: (ctx: Context) => Promise<void>) => async (ctx: Context) => {
		try {
			await handler(ctx)
		} catch (err) {
			console.error("[bot] command failed:", err)
			await ctx.reply("Greška pri pretrazi. Pokušaj ponovo za koji trenutak.").catch(() => undefined)
		}
	}

	bot.command(["start", "help"], guarded((ctx) => ctx.reply(helpText(), OPTS).then(() => undefined)))
	bot.command("prati", guarded(handleWatch))
	bot.command("stop", guarded(handleStop))
	bot.on("message:text", guarded(handleText))

	return bot
}
