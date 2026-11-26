# RealDeal

> Electronics search for Serbia that understands how people actually write listings. Team **JDI** · JigJoy AI Hackathon 2026

One query searches KupujemProdajem, eponuda and Cenoteka at once. A swarm of concurrent agents, built on [Mozaik](https://github.com/jigjoy-ai/mozaik), pages through each site, catches the right listings even when the title is misspelled ("ajfon 15 pro maks", "IPHONE15PROMAX", "Ајфон"), throws out look-alikes (cases, broken or locked phones, "kupujem" ads), and ranks what is left against the market price.

Three modes, on the web and in a Telegram bot:

- **Pretraga (search):** every matching listing from every source, grouped by model, with a price verdict.
- **Budžet (budget):** "the best phone for 100.000 RSD". The budget is a **hard cap**: nothing whose price plus delivery is over it is picked or even listed. Enforced in code and covered by tests ([src/search/rank.test.ts](src/search/rank.test.ts), [src/bot/bot.test.ts](src/bot/bot.test.ts)).
- **Prodaja (sell):** describe what you have; get a quick-sale and a patient price from comparable listings, plus a draft ad. RealDeal never posts anything for you.

## Run

```bash
npm i
npm run dev        # server + UI on http://localhost:8787
npm run check      # three searches at once, prints a summary and 11 self-checks (`-- --log` prints every event)
npm test           # matcher (115 labelled titles), budget cap, sources, the bot's commands against a fake Telegram API
npm run bot        # Telegram bot on its own; needs TELEGRAM_BOT_TOKEN in .env
                   # (with the token set, `npm run dev` / `npm start` also run the bot, sharing the same agents)
npm run fixtures   # regenerates the demo data in data/fixtures
npm run build      # builds the UI into web/dist; `npm start` then serves it
npm run typecheck
```

Optional: `OPENAI_API_KEY` in `.env` turns on an LLM fallback for titles the rules can't decide. Without it, those titles are left unmatched.

## How agents run concurrently

Every agent is a Mozaik participant on one shared runtime. `publish()` hands each event to every matching handler **without awaiting it**, so handlers run on their own and overlap. There is no scheduler and no "fan out, wait, aggregate" step. Every event carries a `searchId`, so many searches share the same agents at once.

| Agent | Reacts to | Emits |
|---|---|---|
| QueryAgent | `search.requested` | `search.planned` (spelling variants to search for, since the sites' own search is literal) |
| Source:kp / Source:eponuda / Source:cenoteka | `search.planned`, its own `page.next` | `listing.found` per listing, then `page.next` for the next page, or `source.done` |
| MatcherAgent | `listing.found` | `listing.matched` or `listing.rejected` |
| PriceAgent | `listing.matched` | `price.assessed` (market price, flag) |
| ShopCheckAgent | `listing.matched` from shops | `discount.checked` (Serbia's 30-day rule), `shop.trust.changed` |
| RankerAgent | `price.assessed`, `discount.checked`, `shop.trust.changed` | `results.updated` |
| SellAgent | `results.updated`, `source.done` in sell mode | `sell.estimate` |

- **Sources page themselves.** Each source agent emits its own `page.next`, so three sites page in parallel. Each one stops on its own: last page, page limit, time budget, enough matches, or a cancelled search.
- **Results stream in.** The first matches reach the screen while the sources are still paging; the UI and the bot get throttled updates over SSE.
- **Cascade:** when ShopCheckAgent catches a shop showing a fake "previous price", that shop's trust drops (−10 per fake, +3 per honest discount). RankerAgent then re-scores every row from that shop in every open search, and a shop under 60 trust is never picked.

`npm run check` proves this from the event log: peak handlers in flight, which agents overlapped, and that first results came before the last source finished.

## Sources and data

All data in this repository is **synthetic** ([data/fixtures](data/fixtures)). Shop names, sellers and prices are fictional and say nothing about any real retailer. Every source runs from fixtures by default, which imitate a site's literal search, its paging and its latency.

Live fetching goes through [src/sources/http.ts](src/sources/http.ts): robots.txt check, rate limit, cache, backoff, and an honest User-Agent. KupujemProdajem's terms forbid automated collection, so the KP adapter stays fixture-only unless KP gives permission.

One live source exists, off by default: `LIVE_SOURCES=gigatron` in `.env` adds real Gigatron prices ([src/sources/gigatron.ts](src/sources/gigatron.ts)). It never uses Gigatron's search, which robots.txt disallows. It matches terms against product URLs from Gigatron's sitemap and opens only the matching product pages, one request every 2 s. The first run builds the index (~45 requests, about 90 s) and caches it in `data/cache` for a day. Gigatron's terms allow its content for personal, non-commercial use only, so this is for the local prototype; ask Gigatron before using it anywhere public.

## Docs

- [docs/PROJECT_BRIEF.md](docs/PROJECT_BRIEF.md): what we're building and the rules we hold to.
- [docs/PIVOT_PROMPT.md](docs/PIVOT_PROMPT.md): the full spec for the pivot from the Black Friday checker.
- [legacy/blackfriday](legacy/blackfriday): the original Black Friday fake-discount checker. Its 30-day rule lives on in [src/rules/thirtyDay.ts](src/rules/thirtyDay.ts).
