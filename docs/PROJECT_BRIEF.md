# RealDeal — Project Brief

> Context file for Claude Code. Read fully before writing code. The full pivot spec is [PIVOT_PROMPT.md](PIVOT_PROMPT.md).
> Team: **JDI (Just Do It)**. The original Black Friday fake-discount checker is in `legacy/blackfriday/`.

---

## 1. Hard constraints (hackathon)

- **MUST use Mozaik** (`@mozaik-ai/core`) and run **2+ agents concurrently**. Judges weigh genuine concurrency most and penalize "a sequential pipeline in disguise" and "fan out → wait → aggregate".
- **Data:** synthetic or public only. No real accounts, no real money movement.
- **Submission:** accessible repo, description, and an explanation of how agents run concurrently. Demo video, live link and screenshots strongly recommended.

---

## 2. The product

**RealDeal is a search engine for electronics in Serbia.** One query covers classifieds (KupujemProdajem) and price-comparison sites (eponuda, Cenoteka), and more sources can be added as adapters.

**The moat is the search engine.** The sites' own search is literal: "ajfon 15 pro maks" finds nothing, and "iphone 15 pro" returns cases and broken phones. RealDeal:

- expands a query into the spellings people actually use (aliases, Cyrillic, glued words like "iphone15promax");
- pages through every result page of every source, not just the first;
- matches titles to a product catalogue with normalization, an alias dictionary and fuzzy matching on words (numbers must match exactly, so a 15 never becomes a 16), with an optional LLM fallback for the rest;
- rejects look-alikes: accessories, damaged, locked, replicas, "kupujem" (wanted) ads, and other models;
- ranks what's left against the market price and flags too-cheap classifieds as suspicious.

**Three modes**, on the web and in a Telegram bot (grammY):

| Mode | User says | Gets |
|---|---|---|
| Search | "ajfon 15 pro maks" | Every matching listing, grouped by model, with a price verdict |
| Budget | "best phone for 100.000 RSD" | Up to 3 picks, one per model. **Price + delivery is never over the budget.** Enforced in `withinBudget`, tested in `rank.test.ts` |
| Sell | "iPhone 13 128GB polovan, baterija 86%" | Quick-sale and patient price from comparable listings, plus a draft ad. **We never post for the user.** |

Focus: electronics (phones, laptops, tablets, consoles, TVs, headphones, GPUs, watches).

---

## 3. Agents (event-driven on one Mozaik runtime)

Every event carries a `searchId`, so many searches share the same agents. No agent waits for another.

| Agent | Listens to | Emits |
|---|---|---|
| QueryAgent | `search.requested` | `search.planned` |
| Source:&lt;id&gt; (one per adapter) | `search.planned`, its own `page.next` | `listing.found`, `page.next`, `source.done` |
| MatcherAgent | `listing.found` | `listing.matched` / `listing.rejected` |
| PriceAgent | `listing.matched` | `price.assessed` |
| ShopCheckAgent | `listing.matched` (shops) | `discount.checked`, `shop.trust.changed` |
| RankerAgent | `price.assessed`, `discount.checked`, `shop.trust.changed` | `results.updated` |
| SellAgent | `results.updated`, `source.done` (sell mode) | `sell.estimate` |

Concurrency moments to show:
1. Three sources page in parallel while the matcher works on listings that already arrived.
2. First results reach the screen before the last source finishes.
3. A shop caught faking a discount (30-day rule) loses trust, and its rows drop in every open search at once.
4. Several searches (web + bot) run on the same agents at the same time.

---

## 4. Sources and scraping rules

- Every adapter implements `SourceAdapter` (`src/search/types.ts`). Fixture mode is the default, so tests and the demo run offline.
- Live fetching goes only through `politeFetch` (`src/sources/http.ts`): robots.txt, rate limit, cache, backoff, honest User-Agent with no personal data.
- **If a site's terms or robots.txt forbid automated access, stop and ask. Don't work around it.** KupujemProdajem's terms forbid it, so KP stays fixture-only unless KP gives permission. eponuda sits behind Cloudflare. Cenoteka is mostly groceries, so it adds little for electronics.
- No accounts, no posting listings, no logging in on anyone's behalf.

---

## 5. Data

All data is synthetic (`data/fixtures`, regenerate with `npm run fixtures`, seeded RNG). Shop names are fictional and must not be presented as real retailers' behaviour.

---

## 6. Out of scope

- Posting ads, user accounts, payments, escrow, chargebacks
- Getting around robots.txt, terms, Cloudflare or rate limits
- Non-electronics categories (for now)

---

## 7. Next steps

1. A live adapter for a source that allows it, behind the live flag.
2. More aliases and catalogue models from real query logs.
3. Keep the bot's `/prati` watches across restarts (they live in memory now).
4. Deploy: one Node server for the UI and the API, plus the bot.
