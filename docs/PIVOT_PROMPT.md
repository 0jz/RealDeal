# Pivot prompt: RealDeal → electronics search engine + website + Telegram bot

> Paste everything below the line into Claude Code, run from the repo root.

---

You are pivoting **RealDeal** (this repo) from a Black Friday fake-discount checker into a **Serbian electronics search engine** with a website and a Telegram bot. Before writing any code, read `README.md`, `docs/PROJECT_BRIEF.md`, `src/agents/kit.ts`, `src/runtime.ts`, `src/swarm.ts` and every agent under `src/agents/`. Then give me a short plan (phases, files you'll touch, a check for each phase) and wait for my OK.

## What we're building

One search core, two front ends:

1. **Website**: a search box, results that stream in as each source answers, filters (price, condition: new / sealed / used, city, shop), and a "best pick" panel.
2. **Telegram bot**: the same search core through chat: `/trazi <query>`, `/budzet <amount> <category>`, `/prodaj <item>`, `/prati <query> <max price>` (alert when a matching listing appears).

Focus for now: **electronics only** (phones, laptops, tablets, consoles, TVs, headphones, components, cameras).

## The moat: the search engine

The search engine is what sets us apart from KP's own search, Cenoteka and eponuda. Put most of the effort here. It must:

- **Search several sources at once:** KupujemProdajem (KP) first, then Cenoteka and eponuda.rs, and be built so that adding another site (shops, other classifieds) means writing one adapter file, not touching the core.
- **Let agents look through whole sites, not just the first page:** follow pagination, open listing detail pages when the snippet lacks the price, condition, storage or model, and keep going until a stop rule fires (enough good matches, page limit, time budget).
- **Find right results that are spelled wrong.** Sellers write "ajfon 15 pro", "iphone15pro", "Ifone 15 Pro Maks", "samsumg s24", "S 24 ultra", "РС5" or "ps5 slim dsk". The engine has to:
  - normalize text: lowercase, Cyrillic ↔ Latin transliteration, diacritics (č ć š ž đ → c c s z dj), spacing and joined model numbers ("15pro" → "15 pro"), units ("256gb", "256 GB", "256g");
  - use a brand/model alias dictionary for electronics (phonetic Serbian spellings, common typos, short forms like "pro max" / "pm");
  - fuzzy-match (trigram or edit distance) against a **canonical product catalogue** (brand, model, variant, storage, color);
  - use the LLM only as a fallback for listings the rules can't place, and cache every LLM decision so the same title is never sent twice;
  - expand the query before it goes out (search each source for the known spellings too, not just what the user typed);
  - drop look-alikes that aren't the product: cases, chargers, "kutija", "za delove", "ne radi", "iCloud lock", "replika", and a different model in the same family (15 vs 15 Pro).
- **Group results by canonical product** so the same phone from KP, a shop and eponuda shows as one item with its prices side by side.
- **Score every result**: match confidence, price vs the market for that exact model and condition, seller signals where the source exposes them, and our existing 30-day-rule and ShopTrust checks for shop prices.

## Buy with a hard budget

"I have 100,000 RSD, give me the best phone for that money."

- The budget is a **hard cap**. No result over it may ever be shown as a pick, including delivery cost when the source gives one. Enforce this in code (a filter plus a test), not in the LLM prompt.
- "Best" is defined by rules we can explain: newer model and better specs for the price, condition, match confidence and seller/shop trust. Say in one line why each pick won.
- Show the top 3 picks under budget and how much each leaves unspent.

## Sell

The user says what they want to sell (e.g. "iPhone 13, 128GB, used, battery 86%").

- Find comparable listings (same canonical model, condition and storage), and give a realistic price range: a quick-sale price and a patient price, with the listings it's based on.
- Draft a listing title and description they can paste into KP.
- **Do not post anything to KP or any site on the user's behalf**, and don't create accounts. The user posts it themselves.

## Keep Mozaik, and keep it truly concurrent

We still build on Mozaik (`@mozaik-ai/core`). Don't guess its API; follow how `src/agents/kit.ts` and `src/runtime.ts` already use it. Keep the event-driven style the judges score: no central scheduler, no "fan out, wait for all, then aggregate".

Suggested agents (change them if you have a better split, and tell me why):

| Agent | Listens to | Does | Emits |
|---|---|---|---|
| QueryAgent | `search.requested` | normalizes the query, expands spellings, resolves budget / sell intent | `search.planned` |
| One SourceAgent per site (KP, Cenoteka, eponuda, …) | `search.planned`, `page.next` | fetches result pages through its adapter, follows pagination and detail pages | `listing.found`, `page.next`, `source.done` |
| MatcherAgent | `listing.found` | maps the raw listing to a canonical product (rules → fuzzy → cached LLM) or rejects it | `listing.matched` / `listing.rejected` |
| PriceAgent | `listing.matched` | market price per model and condition, flags too-cheap (likely scam) and too-expensive | `price.assessed` |
| ThirtyDayAgent, ShopTrustAgent (existing) | shop listings | reuse for shop prices | as now |
| RankerAgent | everything above | keeps a live ranked result list and updates it on every event; enforces the budget cap | `results.updated` |
| SellAgent | `sell.requested` | comparables → price range → listing draft | `sell.estimate` |

Results go to the website over the existing SSE stream and to Telegram as an edited message, so both update live as sources answer.

## Fetching rules (non-negotiable)

- One **adapter per site** behind a common interface: `search(query, page)`, `detail(url)`, `parse(html) → RawListing[]`. Prefer a site's public API or feed when one exists. For an unknown site add a generic adapter that uses the LLM to extract listings from the page, cached by URL.
- Respect each site's robots.txt and terms. Check KP's, Cenoteka's and eponuda's before writing their adapters and tell me what they allow. If a site forbids automated access, stop and ask me; don't work around it.
- Per-domain rate limit, an honest User-Agent with no personal data in it, response caching, retries with backoff.
- Every adapter has a **recorded fixture mode** (saved HTML/JSON pages) so tests and the demo run offline. Live fetching sits behind a flag.

## Telegram bot

- Use grammY. Token in `.env` (`TELEGRAM_BOT_TOKEN`), add it to `.env.example` without a value.
- Same search core as the website; the bot is a thin front end, no logic of its own.
- Long polling for local dev; webhook option for deployment.

## Out of scope for now

Payments, escrow, user accounts on our side, posting listings for users, browser extension, non-electronics categories.

## How to check each phase

- **Matcher:** a test set of at least 50 real-looking misspelled titles mapped to the right canonical product, plus look-alikes that must be rejected. Report precision and recall; run it on every change to the matcher.
- **Budget:** a test where every pick is ≤ budget, including one where the cheapest good match is 1 RSD over and must be left out.
- **Adapters:** fixture tests for each site's parser.
- **Concurrency:** the timeline shows SourceAgents and the Matcher overlapping, and results appear before the slowest source is done.
- **End to end:** run the site in the browser pane and the bot against a test chat; screenshot both.
- `npm run typecheck` and `npm run check` pass.

Update `README.md` (what it is now, how agents run concurrently, run instructions) and replace `docs/PROJECT_BRIEF.md` with the new brief once I approve the plan.
