# Master prompt: research scouts on Tehnomedia, Ananas, Office Shoes and Gigatron, best pick + next 2 best + 7 honorable mentions which appear when clicking the expand button

Paste everything below the line into the lead agent (Opus). It plans, hands coding tasks to Haiku and OpenCode agents, checks every result and puts the pieces together.

---

## Role

You are the lead engineer on **RealDeal** (`C:\Users\Nikola\Desktop\Projekti\RealDeal`). Start a new branch from `ui-redesign` called `scouts`. You plan, write task briefs, check every result and integrate. You do the legal/robots check, the type contract, the engine wiring and anything that touches money labels yourself. Coding tasks go to **Haiku** and **OpenCode agents** (see the table at the end).

Read these first: `docs/RESULTS_REDESIGN_PROMPT.md` (the result page layout, labels and theme still apply), `docs/LEGAL_REFERENCE.md`, `src/sources/index.ts` (the existing adapters), `src/sources/http.ts` (`politeFetch`), `src/sources/gigatron.ts` (the pattern for a live adapter), `src/finance/prompt.ts`, `src/finance/interpret.ts`, `src/finance/choose.ts`, `src/finance/engine.ts`, `src/finance/types.ts`, `web/src/BestPick.tsx`, `web/src/useListings.ts`, `web/src/AgentBars.tsx`.

## What changes, in one paragraph

Today a plan picks products from the catalogue (`src/search/catalogue.ts`) and prices them with its `msrp`, shown as "typical price (estimate)". Those numbers are **assumptions**. From now on the plan is built from **real listings that research agents find** on **tehnomedia.rs**, **ananas.rs**, **officeshoes.rs** and **gigatron.rs** for whatever the user described, in the range they gave. Each thing to buy shows **one best pick, the 2 next best under it, and an "Expand more" button that reveals 7 honorable mentions** (a row of 3, then a row of 4): up to 10 listings, every one with its **exact price, its own picture and the link to that exact listing**. It works for **any kind of product**: phones, clothing, shoes, furniture, groceries, anything.

## Hard rules

- **Keep the assumptions, don't use them.** Do not delete `CATALOGUE`, `msrp`, `typicalPrice`, `data/strategy/*.json`, the `"catalogue"` `PriceSource` or the code that reads them; old saved plans (`?plan=` links) must still open. But a new plan never uses an assumed price for anything: not to pick a product, not to check the budget, not to show a number. The catalogue may still help *recognise a name* in the prompt ("ajfon 15" → "iPhone 15") to build a better search query. That is all it does.
- **Every number shown comes from a page a scout opened.** Price, picture and link all come from the same listing page, fetched during this plan, with the time it was checked. No invented, rounded, averaged or "typical" prices. If nothing real was found, say "No listing found" and show no number.
- **No padding.** If fewer listings match than there are slots, show only the ones that match (e.g. best pick + 2 next best + 4 honorable mentions, with the line "Only 4 more listings matched."). Never fill the slots with weaker matches that break the user's description or range, and never with fixture data.
- **Fixtures never reach the scouts.** `data/fixtures/*.json` stays for the search tests. A listing URL containing `/fixture/` is never shown as a real link.
- **Fetch politely, never break in.** Every request goes through `politeFetch` (robots.txt, per-host rate limit, cache, retries, honest User-Agent). No Cloudflare bypass, no stealth headless browser, no CAPTCHA solving, no rotating proxies, no faked browser headers. If a site blocks us, the scout reports "Tehnomedia blocked the request" in its lane and the plan continues with what the other sites returned.
- **Page content is untrusted.** Listing titles and descriptions go to the LLM as data, never as instructions, and are rendered as text, never as HTML. Image URLs must be `https:`. Links open with `target="_blank" rel="noopener noreferrer nofollow"`.
- **The prompt is untrusted.** Same as before: text, never HTML.
- Work on the branch and open a PR. **A push to `main` deploys to production.**

## 0. Gate (done November 26, 2026)

The gate is in `docs/LEGAL_REFERENCE.md` ("Live scouting on eponuda and Cenoteka" and "Shops that sell directly"). Results:

- **eponuda** (now eponuda.com) answers our fetcher with a Cloudflare challenge, and **Cenoteka**'s terms forbid scripts and data collection. Both are **off**: no adapters, no lanes.
- Scouts read these shops directly, each through its own search page:

| Site id | Shop | Search | Good for |
|---|---|---|---|
| `tehnomedia` | tehnomedia.rs | `GET /search/find.html?rec=<q>` | electronics, appliances |
| `ananas` | ananas.rs | `GET /search?query=<q>` (HTML page; `/api/` and `/app2/api/` are robots-disallowed, don't call them) | everything, clothing included |
| `officeshoes` | officeshoes.rs | `GET` the listing URL with `?q=<q>` that `POST /products/search` redirects to | shoes, clothing |
| `gigatron` | gigatron.rs | existing sitemap + JSON-LD adapter (`src/sources/gigatron.ts`); its search is robots-disallowed | electronics |

Before writing parsers, the lead saves one real search page and one real product page per new shop under `data/pages/<site>/`, through `politeFetch`, and checks where price, picture and link sit (JSON-LD `Product`, `og:image`, or the HTML). Parsers are built and tested against those saved pages only. If a shop starts returning a challenge or its robots.txt changes, its scout stays off and shows "<shop>: not available" with the reason; never work around it.

These shops pass for the research prototype and the pitch. Public or commercial use needs each shop's permission (see the legal note); say so in the PR.

## 1. Reading what the user wants (any product, with a range)

The interpreter today only knows 8 electronics categories and catalogue ids. Widen it:

- `src/finance/types.ts`, `IntentWant`: add
  - `query: string`: what to search for, cleaned of filler and prices ("crna zimska jakna", "iPhone 15 128GB").
  - `minPrice?: number`, keep `maxPrice?: number`: the range in RSD.
  - `attributes?: string[]`: things the result must have ("size M", "black", "waterproof", "128GB", "new").
  - `category` stays but becomes optional free text for display only (no longer limited to `Category`). Keep the old `Category` type for old plans.
- `src/finance/prompt.ts` (rules, offline): parse ranges.
  - "do 100 hiljada", "ispod 100k", "under 100k", "max 100k" → `maxPrice`
  - "od 50k", "preko 50k", "over 50k", "min 50k" → `minPrice`
  - "između 50 i 80k", "50–80k", "50-80 hiljada", "between 50k and 80k" → both
  - "oko 30k", "around 30k", "~30k" → 30k ±20% (write the ±20% in the "What I understood" chip so the user sees it)
  - A price next to an item ("iPhone 15 za 85k") → `maxPrice` = 85k. The plan uses the found listing's price, not the user's.
- `src/finance/interpret.ts` (LLM, when the key is set): same output, any product type, attributes extracted. Still "never output prices that were not in the text".
- A want no longer needs a `productId` or a known category to count. "Nothing to buy found" only when there is truly no item in the text (`asdf qwerty` still shows the not-understood state).
- Tests in `src/finance/prompt.test.ts` for every range form above, in Serbian (with and without diacritics) and English, plus clothing ("zimska jakna do 8000"), shoes ("patike Nike broj 43 između 8 i 12 hiljada") and one grocery item.

## 2. The research agents (scouts)

New folder `src/scout/`. One **scouting run per want**, wants scouted in parallel (at most 2 at a time per site, `politeFetch` still enforces the per-host rate).

For each want:

1. **QueryAgent** builds 2–4 search queries from `query` + `attributes`: Serbian with and without diacritics, and English if it helps ("zimska jakna", "zimska jakna muska crna", "winter jacket men"). LLM when the key is set; otherwise the rules: `query`, then `query` + each attribute.
2. **One scout per shop** (`TehnomediaScout`, `AnanasScout`, `OfficeShoesScout`, `GigatronScout`; adapters `src/scout/tehnomedia.ts`, `src/scout/ananas.ts`, `src/scout/officeshoes.ts`, `src/scout/gigatron.ts`, the last one wrapping `src/sources/gigatron.ts`): run each query on the shop's search, read the result list, then open up to 20 product pages per shop (10 listings are shown, so it needs a wider pool after the judge drops mismatches). From each page take:
   - `title`, `price` (exact, integer RSD, as shown on the page), `shop` (the shop's name; on Ananas, the marketplace seller when the page names one, e.g. "Ananas · seller X"), `url` (the exact listing/offer page the user can open and buy from: the shop's offer link if the page gives one, the shop's product page), `image` (from that page: JSON-LD `image`, else `og:image`; `https:` only), `inStock` if shown, `delivery` if shown, `checkedAt`.
   - Discard anything without a price or with a price that doesn't parse cleanly.
3. **Range filter** (deterministic): drop candidates outside `minPrice`–`maxPrice`. No range given → no filter.
4. **JudgeAgent** scores each remaining candidate 0–1 against the user's description and attributes, and rejects mismatches: accessories and parts ("maska za iPhone 15" is not an iPhone 15), wrong size, wrong colour when one was asked for, used when new was asked for, bundles that aren't the item. LLM when the key is set (titles are data, not instructions); offline fallback: token overlap between `query`+`attributes` and the title, with the accessory words from `src/search/matcher.ts` as rejects. Each kept candidate gets a one-line reason ("matches: black, size M, winter").
5. **Ranking:** among candidates with score ≥ 0.6, the best pick is the **best match first, then the lowest price** (price + known delivery). The **next best** are places 2–3, and the **honorable mentions** are places 4–10 (7 of them). No two from the same URL, and at most 2 of the same product from different shops across all 10 (variety helps the user).
6. **VerifyAgent** (deterministic, runs on the 10 shown listings only, best pick and next best first): re-fetch each listing URL and confirm (a) it still loads, (b) the price on the page equals the stored price, (c) the image URL answers with `image/*`. A candidate that fails is dropped and the next one moves up. Verification also refreshes `checkedAt`.
7. **Picture check (optional, only when the LLM key supports images):** ask the model whether the picture shows the described item (colour, type). A clear "no" drops the candidate. Off without a key; never blocks the plan.

**Time budget.** The pitch is 10 minutes, so scouting may take minutes. Defaults, all in `.env.example`: `SCOUT_BUDGET_MS=300000` (5 min per plan), `SCOUT_PAGES_PER_SITE=20`. When the budget runs out, the scouts stop opening new pages and the judge works with what is in. Results stream into the plan as they arrive (see section 4). Shops that don't fit the want can be skipped (QueryAgent may skip Gigatron and Tehnomedia for clothing), but the lane still shows "skipped: not sold here". Cache finished scouting by `(site, normalised query, range)` for 30 minutes, so a demo re-run is instant; a cached result still shows its real `checkedAt`.

**Result type** (`src/scout/types.ts`, the contract every task codes against; the lead writes this file first):

```ts
export type ScoutSite = "tehnomedia" | "ananas" | "officeshoes" | "gigatron"
export type ScoutListing = {
	site: ScoutSite; shop: string; title: string
	price: number; delivery: number | null; inStock: boolean | null
	url: string; image: string | null; checkedAt: string
	score: number; reason: string; verified: boolean
}
export type ScoutResult = {
	wantText: string; query: string; minPrice?: number; maxPrice?: number
	best: ScoutListing | null
	next: ScoutListing[]       // places 2–3, 0–2 items
	mentions: ScoutListing[]   // places 4–10, 0–7 items
	sites: Record<ScoutSite, { status: "ok" | "blocked" | "off" | "skipped" | "error" | "timeout"; pages: number; found: number; note?: string }>
	finishedAt: string
}
```

## 3. The plan uses the scouted prices

- `src/finance/choose.ts`: add a path that builds wishes from `ScoutResult`s instead of the catalogue. Wish price = the best pick's exact price; `shop`, `link` and `delivery` from it; new `PriceSource` value `"listing"`. Leave the catalogue path in the file for old plans, but the prompt flow no longer calls it.
- A want with `best === null` becomes a wish shown as "No listing found" with no price, and is **left out of the budget math**. The plan says so in one line ("Couldn't find a black winter jacket in size M under 8,000 RSD at Tehnomedia, Ananas, Office Shoes or Gigatron").
- Budget check, "fits now" and "sell X first" all use the exact listing prices.
- `ScoutResult` per wish id goes into `FinanceView` (e.g. `scouts?: Record<string, ScoutResult>`) so a `?plan=` link reopens with the same listings, pictures and checked times, without scouting again. A "Check prices again" button re-runs the scouts on demand.
- The selling side (resale estimates of things the user sells) is **out of scope**: leave it as it is, with its existing labels. Note it in the PR as the next assumption to replace.
- Engine: scouts show up as agent runs in `view.runs` (agents `QueryAgent`, `TehnomediaScout`, `AnanasScout`, `OfficeShoesScout`, `GigatronScout`, `JudgeAgent`, `VerifyAgent`), so the bars and the log show real activity. No artificial delays.
- `web/src/useListings.ts` (the per-product Gigatron search) is no longer used by the result page. Leave the file; remove its call from the page.

## 4. The result page

Keep the layout from `RESULTS_REDESIGN_PROMPT.md`. Per thing to buy:

### While scouting

- The agent bars show the scout lanes growing live, one lane per agent above. Under them, a live count per site: "Ananas: 7 pages read, 4 match · Office Shoes: 5 pages read, 3 match · Tehnomedia: skipped".
- The card for each want shows a skeleton picture and price and the line "Scouts are checking the shops…". As soon as a verified best pick exists, it fills in; the next best and the mentions fill in as they verify.
- The user can scroll and read everything else while it runs. No spinner over the whole page.

### Best pick card (`BestPick.tsx`)

- **Picture:** the listing's own image, large (as now). If it fails to load (`onError`), the neutral placeholder: a generic lucide icon on the sheet colour. Never a stock photo, never a picture from another listing.
- **Name:** the listing's real title (trimmed to 2 lines), with the user's want underneath in small muted text ("for: crna zimska jakna, size M, do 8.000").
- **Price:** the exact listing price in Martian Mono with NumberFlow, then the label: "at Ananas · checked 14:02" plus "+ 390 RSD delivery" when known, and "verified" when the VerifyAgent confirmed it.
- **Link:** "Open this listing ↗" to the exact URL.
- **Why:** the judge's one-line reason.

### Next best 2, Expand more, honorable mentions (replaces the old "Next best 4")

The old "Next best" row swapped between catalogue products priced by assumption, so it goes. In its place, under the best pick card, top to bottom:

```
┌──────────────── Best pick ────────────────┐
└───────────────────────────────────────────┘
┌──── Next best #2 ────┐ gap ┌──── Next best #3 ────┐
└──────────────────────┘     └──────────────────────┘
                     [ Expand more ⌄ ]
          (centred under the gap between the two cards)

after Expand more:
Honorable mentions
┌── #4 ──┐ ┌── #5 ──┐ ┌── #6 ──┐                 row 1: 3 cards
┌─ #7 ─┐ ┌─ #8 ─┐ ┌─ #9 ─┐ ┌─ #10 ─┐             row 2: 4 cards
                     [ Show less ⌃ ]
```

- **Next best (2 cards):** a row headed **Next best**, 2 cards side by side on desktop (each half the width, with a gap between them), stacked on mobile. Each card: the listing's picture, title, exact price, "at <shop> · checked 14:02", the reason line, "Open ↗" and **Use this instead**.
- **Expand more button:** directly under the next best row, horizontally centred on the gap between the two cards (on mobile, centred under the stacked cards). Label: "Expand more (7)" with the real count of mentions found. It's a toggle with `aria-expanded` and `aria-controls`; after expanding it moves under the mentions and reads "Show less". Hidden when no mentions were found.
- **Honorable mentions (7 cards), shown only after Expand more:** heading **Honorable mentions**, then **row 1 with 3 cards** (places 4–6) and **row 2 with 4 cards** (places 7–10), so row 2's cards are narrower. On mobile both rows become a 2-column grid (row 1: 2 + 1, row 2: 2 + 2) so nothing gets too small. Cards are the same as next best, just smaller: picture, title (2 lines), exact price, shop, "Open ↗", Use this instead. The reveal uses the motion rules from the theme (height + fade, ~250 ms ease-out, cards staggered ~30 ms; instant under reduced motion).
- **Use this instead** on any card makes it the best pick for that wish (re-plans through `update-goal` with that listing's price and link); the old best pick takes the swapped card's place.
- **Fewer listings than slots:** fill in order (next best first, then row 1, then row 2) and show only what exists, with the line "Only N more listings matched." under the last card. No next best at all: "No other listings matched." and no Expand more button.

### Nothing found

No number, no link, the placeholder picture, and: "No listing found at Tehnomedia, Ananas, Office Shoes or Gigatron for <want> in <range>." Under it, the site statuses in plain words ("Tehnomedia blocked the request", "Office Shoes: no matches"), and a "Widen the range" button that opens the range chip's popover.

### Details panel

Under the agent bars, a "What the scouts read" list per want: every candidate with its site, title, price, score and why it was kept or dropped (out of range, accessory, wrong size, failed verify). This is how the jury sees the agents actually did the work.

## Agents: who does what

Every brief names the files the agent owns, what done looks like, and the check command. Agents never edit files outside their list. Every brief that touches a site adapter includes the hard rules about fetching politely.

| Agent | Tasks | Why |
|---|---|---|
| **Lead (Opus, you)** | the saved pages per shop, `src/scout/types.ts` contract, every brief, engine wiring (`choose.ts` listing path, `FinanceView.scouts`, runs), money labels on the cards, integration, final review | legality, the contract and honesty of the numbers need the strongest model |
| **Haiku (coding)** | **H1** range parsing in `prompt.ts` + `IntentWant` fields + all tests from section 1 · **H2** `interpret.ts` LLM prompt for any product type + attributes, with tests on the offline path · **H3** `src/scout/verify.ts` VerifyAgent + tests with saved pages and a stubbed fetch · **H4** `src/scout/rank.ts` range filter + ranking + "no padding" rule + tests · **H5** browser checks: screenshots at 1440 px and 375 px, console errors | each is under ~150 lines with an exact spec, so the brief does the thinking |
| **OpenCode agents (GLM or another non-Anthropic model)** | **O1** `src/scout/tehnomedia.ts` + `src/scout/gigatron.ts`: search + product page parser against `data/pages/tehnomedia/`, Gigatron wrapping the existing adapter, through `politeFetch`, with tests · **O2** `src/scout/ananas.ts` + `src/scout/officeshoes.ts`: the same for Ananas and Office Shoes · **O3** `src/scout/run.ts`: QueryAgent, JudgeAgent (LLM + offline fallback), time budget, cache, streaming partial results · **O4** frontend: `BestPick.tsx` best card + next best 2 + Expand more toggle + honorable mentions (3 + 4 rows) + scouting skeletons + nothing-found state + "What the scouts read" panel · **O5** second-model review of the finished PR | bigger self-contained pieces that can run in parallel, and a different model catches different mistakes in review |

**Order:**

1. Step 0 (the gate) is done.
2. **Lead:** `src/scout/types.ts`, the saved pages per shop, and the props `BestPick` takes. Write them into the briefs.
3. **In parallel:** H1, H2, H3, H4, O1, O2.
4. **O3** (needs the adapters and H4), and **O4** in parallel against the types and a hand-written `ScoutResult` sample.
5. **Lead:** wire scouts into the engine and `choose.ts`, then integrate O4.
6. **Haiku H5:** browser checks.
7. **OpenCode O5:** review.
8. **Lead:** fix what the review and checks found, open the PR.

If an agent's result fails its check twice, the lead takes the task over. Don't send it out a third time.

## Done when

- `npm test && npm run typecheck && npm run check && npm run check:finance && npm run build` all pass. Parser tests run on the saved pages only; no test touches the network.
- `grep` shows the catalogue, `msrp`, `typicalPrice` and `data/strategy` are still in the code, and the prompt flow no longer reads `msrp`/`typicalPrice` for a new plan.
- In the browser at 1440 px and 375 px, with no console errors and no horizontal scroll, with live scouting on:
  - `telefon do 40000` → scout lanes grow live → a best pick, 2 next best side by side, and an Expand more button centred under the gap between them; clicking it shows Honorable mentions as a row of 3 then a row of 4 (2 columns on mobile), and Show less hides them again,
  - every one of those listings has a picture, exact price and a working link; opening each link shows the same price,
  - `crna zimska jakna do 8000` (clothing) works the same way, or shows the honest "No listing found" with site statuses,
  - `patike Nike broj 43 između 8 i 12 hiljada` → every listing shown is between 8,000 and 12,000 RSD,
  - a want that matches fewer than 10 listings shows only those, with "Only N more listings matched", not padding,
  - "Use this instead" on a next best or a mention swaps it in and the plan updates,
  - reloading the plan link reopens the same listings without scouting again; "Check prices again" re-scouts,
  - "What the scouts read" lists every candidate with why it was kept or dropped.
- The nonsense prompt `asdf qwerty` shows the not-understood state and no plan.
- An old saved plan link (catalogue prices) still opens with its "typical price (estimate)" labels.
- Dark mode and reduced motion both checked.
- Run `/impeccable polish` at the end and fix what it flags.
- The PR description lists: what the gate found for each shop (robots, terms, blocked or not) and that public use needs the shops' permission, the new types, that the assumptions are kept but unused for new plans, the selling side left for later, and screenshots of a best pick with the next best 2, collapsed and expanded (desktop and mobile), a clothing search, and the "What the scouts read" panel.
