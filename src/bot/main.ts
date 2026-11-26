// Entry for `npm run bot`. Starts the search engine, then the Telegram bot with long polling.
//
// Webhook mode (optional): when TELEGRAM_WEBHOOK_URL is set, the web server could mount
// grammY's `webhookCallback(bot, "http")` at that path instead of calling bot.start().
// Not implemented yet; long polling is used either way.

import "dotenv/config"
import { startEngine } from "../search/agents"
import { createBot } from "./bot"

const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
if (!token) {
	console.error(
		[
			"TELEGRAM_BOT_TOKEN is not set.",
			"Get a token from @BotFather on Telegram: open a chat with @BotFather, send /newbot,",
			"follow the prompts, then copy the token it gives you into .env:",
			"  TELEGRAM_BOT_TOKEN=123456:ABC...",
		].join("\n"),
	)
	process.exit(1)
}

startEngine()
const bot = createBot(token)
await bot.start({ onStart: () => console.log("bot running") })
