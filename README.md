# RealDeal — buy smarter, sell with a plan

**Given what I own, what I want, and my cash, what combination of buying, selling and waiting can I afford?** Team JDI · JigJoy AI Hackathon, November 2026.

You write one sentence: what you want, what you could sell, and how much you can spend ("New phone for 75000 RSD. I can sell my iPhone 13, it's in good shape."). RealDeal picks products from its catalogue that fit, shows what it understood so you can swap a product, type a real price or remove an item, and then checks each offer for risks, estimates missing sale prices from catalogue prices (clearly labelled as estimates), and builds one plan that never spends money you don't have yet. You then mark what you actually sold, bought or set aside, and the plan updates. Plans are saved, so the link brings you back later.

RealDeal does not buy, sell or hold money for you. Every price is labelled "your price" (written by you) or "typical price (estimate)" (catalogue); no shops, links or delivery costs are invented. The full form is still there under **Edit details**. The older electronics search (sample data) stays available through its API and the Telegram bot; it no longer has a web tab.

## Run

Node 22+ (validated locally with Node 25.9.0):

```bash
npm ci
npm run dev                 # http://localhost:8787
npm test                    # financial invariants, native loops, search, sources, offline bot
npm run typecheck
npm run check               # existing search swarm: 11 checks
npm run check:finance       # reproducible buy/sell scenario + actual overlap evidence
npm run build
npm start                   # production UI + API on port 8787
```

No credentials are needed. Set `PORT` to change the port. Plans are saved as JSON in `data/sessions/` (override with `REALDEAL_SESSIONS`) and reload after a restart; at most 100 are kept in memory. Anyone with a plan link can see and change that plan; there are no user accounts, so don't put anything private in a plan title. New plans are limited to 20 per IP per hour; behind a reverse proxy set `TRUST_PROXY=1` so the limit uses `X-Forwarded-For`. Run one process. `/api/health` is a readiness endpoint.

## Walkthrough

1. Open the app and click the example **New phone for 75000 RSD. I can sell my iPhone 13, it's in good shape.**, then **Make my plan**. RealDeal picks the best-scoring phone whose typical price fits 75,000 RSD and plans to sell the iPhone 13 at a labelled estimate. Buying before the sale money arrives is refused.
2. Under **What I understood**, click the phone chip: swap to another phone, type the real price you found (it becomes "your price"), or remove it. The plan updates.
3. Try **Hoću iPhone 15 za 85k, prodajem stari ajfon 13**: the iPhone 15 is kept at your price of 85,000 RSD. Try **asdf qwerty**: nothing is planned and the unmatched words are shown.
4. **Edit details** opens the full form: add a shop and delivery, cut a warranty below the minimum, or enter a price far below the typical one, and the offer is blocked with the reason shown.
5. Under **Track what you did**, mark the sale and purchases. For an estimated price you enter what you actually paid; the ledger records that, never the estimate. Reload the page or copy the link: the plan and your records come back.

## Financial model

All arithmetic is deterministic integer RSD (`src/finance/model.ts`). The bounded optimizer evaluates purchase and asset subsets, respects wish priority, then minimizes unnecessary asset sales. A plan has 1–5 items to buy and 0–5 items to sell. Names are matched to the product catalogue only when the match is unambiguous; the catalogue's typical new price is then used for hints, savings and price-risk checks.

- **Cash balance** = initial cash + confirmed net resale − recorded purchase costs.
- **Available cash** = balance − untouched reserve − explicit cash reservations.
- **Estimated resale** is a conditional funding source for planning only. It never enters the cash ledger.
- **Net resale** = sale price − fees − delivery. If you enter a sale price it is used (medium confidence, range 90–100%). If you leave it blank and the item is in the catalogue, the estimate is 50% (good) or 40% (fair) of the typical new price, marked **catalogue estimate**, low confidence. Unknown items with no price can't fund anything. The sale must fit the deadline.
- **Offer checks** block unknown delivery, warranty below your minimum, and prices under 50% (new) or 25% (used) of the typical price. A missing shop or a non-https link is a warning, not a block.
- Every recorded transaction rechecks current eligibility, cash and revision synchronously. Receipts make retries idempotent. Duplicate sales/purchases are blocked. Risk/price changes invalidate reservations.
- Savings are measured against the catalogue's typical new price, only for new items that match the catalogue.
- The UI separates remaining planned costs/net acquisition cost from confirmed receipts, actual costs and reserved cash. Projected remaining cash includes the untouched reserve.

The old search budget mode still uses its original price-plus-known-delivery semantics; unknown delivery is displayed as unknown. It cannot execute financial-strategy transactions.

## Genuine Mozaik execution

`@mozaik-ai/core` is pinned to **6.0.0** in package.json and package-lock.json. The installed package was inspected, including `runLoop`, `InferenceRunner`, `InterceptionHandler`, context isolation and event publication. See [the runtime audit](docs/IMPLEMENTATION_REPORT.md).

| Participant | Independent responsibility |
|---|---|
| PurchaseAgent | Turn your offers into priced, catalogue-matched offers; optional LLM explanation |
| ResaleAgent | Value what you could sell (your price or a catalogue estimate); optional LLM explanation |
| ShopTrustAgent | Run the offer risk checks; optional LLM risk interpretation |
| StrategyAgent | Explain the current deterministic plan; rerun when its assumptions change |
| BudgetGuardian | Accept versioned findings, recompute the plan, guard cash and intercept obsolete loop transitions |

Four native `runLoop` invocations operate independently with fresh `ModelContext`s. Each result updates shared financial state and the SSE view immediately; no aggregate barrier waits for all agents. Financial and legacy search runtimes are isolated to preserve the original web/bot flows. The financial agents share one typed state within their runtime.

**Offline analysis** uses the supported custom `InferenceRunner` interface with deterministic analysis of your goal. It is real runtime/I/O concurrency, **not LLM inference**. No artificial delays are used. The financial timeline records monotonic start/end times and UTC timestamps, fits fast intervals to the display, and keeps previous activity selectable. The original source fixtures also now use real asynchronous file reads instead of simulated network sleeps.

**Live LLM reasoning** requires `.env`:

```dotenv
REALDEAL_LLM=1
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-4o-mini
# OPENAI_BASE_URL=https://api.openai.com/v1
```

Each financial runner loads its evidence and independently requests an explanation. LLM text cannot mutate amounts, actions, risk thresholds or the ledger. Requests have a 12-second deadline; failure is visible and deterministic findings remain available. Only configure a trusted provider: it receives the goal you entered. The existing optional search matcher also uses `OPENAI_API_KEY`, independently of `REALDEAL_LLM`.

State has a market epoch, financial revision and presentation sequence. Market changes reject obsolete analyst results; every evidence/transaction update invalidates old strategy reasoning. `InterceptionHandler` replaces the **next** outdated transition with a discard message. It does not alter an already submitted model request. Publication checks revisions again. Rapid strategy requests are coalesced, with a fresh run after the current one settles. Tests hold provider responses in flight, change the assumptions, and prove stale output is rejected.

`npm run check:finance` writes `data/out/finance-evidence.json` with actual intervals and the completed scenario. Concurrency timings depend on the machine; offline disk work can complete in milliseconds. Do not describe offline results as proof of concurrent remote AI inference.

## Sources and retained tools

The planner uses only what you enter plus the product catalogue. The search tab's datasets are **synthetic sample data** in `data/fixtures` (regenerate with `npm run fixtures`); named shops there are not real retailers.

The original matcher, aliases, catalogue, ranking, source adapters, SSE search UI, Telegram commands and `legacy/blackfriday` remain. Search covers KP/eponuda/Cenoteka fixtures with misspelling and look-alike handling. `npm run bot` starts Telegram independently; setting `TELEGRAM_BOT_TOKEN` also starts it with the web server. Bot tests use a fake Telegram API; no real messages are sent during validation. Financial strategy commands are currently web/API only.

The opt-in `LIVE_SOURCES=gigatron` adapter is retained unchanged; it is not used by the planner. Its original robots/rate-limit/cache behavior remains. KP remains fixture-only. No new scraping was added; recheck current source permissions before any public commercial use.

Discount checks are reference-price screening, not a definitive legal verdict. Missing history is inconclusive. See [the verified Trade Law reference and exceptions](docs/LEGAL_REFERENCE.md).

## API and deployment

- `GET /api/goal/example` — the example goal.
- `GET /api/products` — catalogue ids, names, categories and typical prices (for hints and swaps).
- `POST /api/goal/from-prompt` — `{prompt, budget?}`; prompt 1–1,000 characters, budget an integer 0–10,000,000 (otherwise read from the prompt). Interprets the prompt (deterministic parser; with `REALDEAL_LLM=1` an LLM may improve the product mapping but never sets amounts), chooses catalogue products and starts a plan. Returns the view with `intent` and `alternatives`, or 422 `{error, unknown}` when nothing matched or no amount was given. Rate-limited like `POST /api/goal`.
- `POST /api/goal` — validate a goal and start concurrent analysis (rate-limited, 429).
- `GET /api/goal/:id` and `/stream` — current snapshot and SSE.
- `POST /api/goal/:id/command` — `{revision, requestId, command}`. Invalid/stale/unsafe commands return 409 and the latest snapshot. Use the same request ID when retrying the same transaction.
- Existing `/api/search` routes are preserved.

CI runs tests, type checks, both scenario checks and a production build. Docker recipe (not required for local use): `docker build -t realdeal .` then `docker run --rm -p 8787:8787 realdeal`. For a server, run `npm start` behind a TLS reverse proxy (e.g. Caddy) with `TRUST_PROXY=1`, and keep `data/sessions/` on persistent disk.

Live at https://realdeal.92-6-28-142.sslip.io. Every push to `main` that passes CI deploys there automatically: the `deploy` job builds the UI, packs the release and pipes it over SSH to [`deploy/realdeal-deploy.sh`](deploy/realdeal-deploy.sh), the only command the `DEPLOY_SSH_KEY` key may run. The script installs the release next to the previous ones, restarts the service and rolls back if `/api/health` fails.

See [implementation assessment, validation and limitations](docs/IMPLEMENTATION_REPORT.md).
