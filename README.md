# RealDeal — buy smarter, sell with a plan

**Given what I own, what I want, and my cash, what combination of buying, selling and waiting can I afford?** Team JDI · JigJoy AI Hackathon, November 2026.

RealDeal combines purchase opportunities, owned assets, resale uncertainty and seller risk into one financial strategy. The existing Serbian electronics search, budget finder and resale drafting tools remain available under **Search / budget / sell tools**, including the Telegram bot. No real purchases, listings, payments or commitments are made.

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

No credentials are needed for the reproducible demo. Set `PORT` to change the port. All state lives in memory and disappears on restart. Financial sessions expire after 30 minutes without a listener/activity and are capped at 100 per process. This is a local/shared demo, without user accounts or private financial storage. Run one process; do not scale replicas without adding persistence/session routing. The Dockerfile builds the UI and starts the same server. `/api/health` is a lightweight readiness endpoint.

## Three-minute demonstration

1. **0:00–0:30 — The objective.** Open the default strategy screen: 70,000 RSD cash, an owned iPhone 13, desired iPhone 15 and headphones. Click **Find my buy + sell strategy**.
2. **0:30–1:00 — The plan.** Show 30,000 RSD estimated net resale, 85,000 RSD phone, 8,000 RSD headphones, 7,000 RSD projected cash; net acquisition cost 63,000 RSD. Expand offer checks: the advertised 20% discount has a 0% observed reduction. These are synthetic examples.
3. **1:00–1:30 — The cash guard.** Try buying the phone before selling: blocked. Click **Resale estimate −10,000 RSD**: headphones are deferred, keeping the phone priority. The lower estimate never creates cash or a negative balance.
4. **1:30–2:00 — Reallocate.** Click **Phone price → 80,000 RSD**: both wishes fit again. Confirm the simulated **gross** sale receipt of 21,000 RSD: 500 RSD assumed fees + 500 RSD delivery leave 20,000 RSD confirmed net. Simulate both purchases; cash ends at 2,000 RSD.
5. **2:00–3:00 — Why agents matter.** Select **Initial concurrent analysis** in the timeline. Show overlapping purchase, resale and risk workloads and actual timestamps. Expand interception evidence: obsolete strategy responses are discarded after new evidence. Explain that AI interprets tradeoffs while code enforces the ledger. With live LLM mode configured, refresh and change the resale assumption while agents are still reasoning.

**Presentation line:** “A bargain is only useful if the whole plan works. RealDeal connects what you can sell with what you want to buy, and refuses to spend money you have not received.”

Internal submission target: **November 27, 16:00 CET**; demo: **17:00 CET**. Offline execution is the reliable fallback.

## Financial model

All arithmetic is deterministic integer RSD (`src/finance/model.ts`). The bounded optimizer evaluates purchase and asset subsets, respects wish priority, then minimizes unnecessary asset sales. The focused UI offers two purchase products and two resale assets; the API accepts up to three wishes/assets. Unsupported products have no invented valuation and remain deferred.

- **Cash balance** = initial cash + confirmed net resale − actual simulated purchase costs.
- **Available cash** = balance − untouched reserve − explicit cash reservations.
- **Estimated resale** is a conditional funding source for planning only. It never enters the cash ledger.
- **Net resale** subtracts explicit assumed fees and seller delivery costs. Condition affects estimates; sale timing must fit the goal deadline. Ranges/confidence derive from synthetic **asking prices**, not completed sales or guaranteed proceeds.
- Purchases include known delivery and meet seller-trust/warranty requirements. Unknown delivery is ineligible in the financial strategy.
- Every simulated transaction rechecks current eligibility, cash and revision synchronously. Receipts make retries idempotent. Duplicate sales/purchases are blocked. Risk/price changes invalidate reservations.
- Forecast savings use observed reference history, not an advertised previous-price claim. Realized savings are recorded only after simulated purchases and are verified **only within the synthetic dataset**, not in the real world.
- The UI separates remaining planned costs/net acquisition cost from confirmed receipts, actual costs and reserved cash. Projected remaining cash includes the untouched reserve.

The old search budget mode still uses its original price-plus-known-delivery semantics; unknown delivery is displayed as unknown. It cannot execute financial-strategy transactions.

## Genuine Mozaik execution

`@mozaik-ai/core` is pinned to **6.0.0** in package.json and package-lock.json. The installed package was inspected, including `runLoop`, `InferenceRunner`, `InterceptionHandler`, context isolation and event publication. See [the runtime audit](docs/IMPLEMENTATION_REPORT.md).

| Participant | Independent responsibility |
|---|---|
| PurchaseAgent | Read purchase evidence, compare delivered prices/warranty; optional LLM explanation |
| ResaleAgent | Read asking-price comparables, condition/fees/liquidity analysis; optional LLM explanation |
| ShopTrustAgent | Read seller-risk evidence; optional LLM risk interpretation |
| StrategyAgent | Explain the current deterministic plan; rerun when its assumptions change |
| BudgetGuardian | Accept versioned findings, recompute the plan, guard cash and intercept obsolete loop transitions |

Four native `runLoop` invocations operate independently with fresh `ModelContext`s. Each result updates shared financial state and the SSE view immediately; no aggregate barrier waits for all agents. Financial and legacy search runtimes are isolated to preserve the original web/bot flows. The financial agents share one typed state within their runtime.

**Offline analysis** uses the supported custom `InferenceRunner` interface with actual asynchronous file reads and deterministic evidence analysis. It is real runtime/I/O concurrency, **not LLM inference**. No artificial delays are used. The financial timeline records monotonic start/end times and UTC timestamps, fits fast intervals to the display, and keeps previous activity selectable. The original source fixtures also now use real asynchronous file reads instead of simulated network sleeps.

**Live LLM reasoning** requires `.env`:

```dotenv
REALDEAL_LLM=1
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-4o-mini
# OPENAI_BASE_URL=https://api.openai.com/v1
```

Each financial runner loads its evidence and independently requests an explanation. LLM text cannot mutate amounts, actions, risk thresholds or the ledger. Requests have a 12-second deadline; failure is visible and deterministic findings remain available. Only configure a trusted provider: it receives the goal and synthetic evidence. The existing optional search matcher also uses `OPENAI_API_KEY`, independently of `REALDEAL_LLM`.

State has a market epoch, financial revision and presentation sequence. Market changes reject obsolete analyst results; every evidence/transaction update invalidates old strategy reasoning. `InterceptionHandler` replaces the **next** outdated transition with a discard message. It does not alter an already submitted model request. Publication checks revisions again. Rapid strategy requests are coalesced, with a fresh run after the current one settles. Tests hold provider responses in flight, change the assumptions, and prove stale output is rejected.

`npm run check:finance` writes `data/out/finance-evidence.json` with actual intervals and the completed scenario. Concurrency timings depend on the machine; offline disk work can complete in milliseconds. Do not describe offline results as proof of concurrent remote AI inference.

## Sources and retained tools

All committed search and strategy datasets are **synthetic**. Named demo shops do not describe real retailers. Strategy source files live in `data/strategy`; broader Serbian search fixtures remain in `data/fixtures` and regenerate with `npm run fixtures`.

The original matcher, aliases, catalogue, ranking, source adapters, SSE search UI, Telegram commands and `legacy/blackfriday` remain. Search covers KP/eponuda/Cenoteka fixtures with misspelling and look-alike handling. `npm run bot` starts Telegram independently; setting `TELEGRAM_BOT_TOKEN` also starts it with the web server. Bot tests use a fake Telegram API; no real messages are sent during validation. Financial strategy commands are currently web/API only.

The opt-in `LIVE_SOURCES=gigatron` adapter is retained unchanged; it is not used by the financial demo. Its original robots/rate-limit/cache behavior remains. KP remains fixture-only. No new scraping was added; recheck current source permissions before any public commercial use.

Discount checks are reference-price screening, not a definitive legal verdict. Missing history is inconclusive. See [the verified Trade Law reference and exceptions](docs/LEGAL_REFERENCE.md).

## API and deployment

- `GET /api/goal/demo` — editable demo goal.
- `POST /api/goal` — validate a goal and start concurrent analysis.
- `GET /api/goal/:id` and `/stream` — current snapshot and SSE.
- `POST /api/goal/:id/command` — `{revision, requestId, command}`. Invalid/stale/unsafe commands return 409 and the latest snapshot. Use the same request ID when retrying the same transaction.
- Existing `/api/search` routes are preserved.

CI runs tests, type checks, both scenario checks and a production build. Docker recipe (not required for local use): `docker build -t realdeal .` then `docker run --rm -p 8787:8787 realdeal`. Docker and public hosting must be rehearsed in the target environment; no deployment or main-branch merge is performed by this change.

See [implementation assessment, validation and limitations](docs/IMPLEMENTATION_REPORT.md).
