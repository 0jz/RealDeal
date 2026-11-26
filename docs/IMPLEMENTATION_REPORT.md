# Buy/sell financial agent — implementation report

## Independent repository assessment

Audited baseline: `b0b80e0` on `origin/main` (November 26, 2026). The workspace initially contained only an empty Git repository; the requested repository was cloned into `RealDeal/`. Only `main` existed remotely; `feature/buy-sell-financial-agent` was created from that baseline. Remote refs were refreshed before delivery and `main` remained at the same commit.

History showed three stages: the original Black Friday checker; its live SSE dashboard and shop-trust cascade; then an electronics-search pivot with web/bot support, strict budget filtering and an opt-in Gigatron adapter. The current source was already substantially different from the original conceptual agent list.

What worked: catalogue/alias matching (115 labelled titles), deterministic ranking and budget filtering, synthetic source pagination, three web modes, Telegram commands tested against a fake API, the shared search runtime, SSE, production build and optional source integration. Baseline validation passed all 66 tests, both TypeScript projects and the Vite production build.

What was absent: a shared buying/selling objective, a cash ledger, confirmed versus estimated proceeds, purchase reservations, a multi-item financial strategy, explicit simulation transactions and versioned strategy responses. The existing sell estimate was separate from budget planning. The UI presented independent tools rather than a unified financial outcome.

Concurrency assessment: search agents were genuine Mozaik event participants, but ordinary offline handlers mostly ran synchronous rules and source timing was padded with `setTimeout`. The optional matcher used a direct HTTP model call rather than native loops. Event fan-out alone did not establish meaningful AI execution. There were no native `runLoop` calls or interception in the search implementation. `@mozaik-ai/core` was already correctly pinned to 6.0.0.

Installed-runtime inspection confirmed that situation processors are not awaited, `runLoop` is fire-and-forget, every loop has a unique ID, custom `InferenceRunner` implementations are supported, and `InterceptionHandler.handle` is awaited before the next transition. These behaviors were checked against the installed declarations/implementation and [Mozaik's loop documentation](https://docs.jigjoy.ai/docs/agent-loop) and [interception documentation](https://docs.jigjoy.ai/docs/interception).

The narrowest reliable extension was a separate financial domain and typed Mozaik runtime alongside the existing engine. This avoids changing the search/bot event contracts. Existing reference-price and median helpers are reused; the new native agent wrappers add the missing shared-state, ledger and strategy responsibilities. No scraping expansion or framework replacement was needed.

## Delivered changes

- Unified goal with cash, reserve, desired products/priorities, assets/condition, explicit assumed fees/delivery, warranty/trust thresholds and sale deadline.
- Bounded deterministic purchase/asset subset selection; conditional sale funding, deferrals and reallocation. The 70k/30k/93k example yields 7k remaining and 63k net acquisition cost.
- Simulated net sale receipts, reservations/releases and purchases. Current revisions, duplicate transaction detection and synchronous cash guards prevent negative spendable balances and double execution.
- Four native Mozaik loops with independent contexts: PurchaseAgent, ResaleAgent, ShopTrustAgent and StrategyAgent. A deterministic BudgetGuardian agent accepts evidence, recomputes plans and participates in interception.
- Three meaningful independent asynchronous evidence reads in offline mode. Optional separate LLM requests reason over role-specific evidence; their text cannot change arithmetic or transactions. Offline mode is explicitly not called AI inference.
- Immediate per-result state/SSE publication; obsolete market epochs and strategy revisions are rejected; a presentation sequence prevents an older HTTP response from overwriting a newer SSE snapshot. Strategy refreshes are coalesced.
- Native interception changes the next outdated loop transition, never an already submitted request. A controlled integration test changes the plan while four mocked-provider requests remain in flight, then proves their obsolete outputs are rejected.
- Unified UI, financial outcomes, uncertainty, simulation controls, market shocks, seller/discount evidence, revision history, actual UTC/monotonic intervals and selectable execution cycles. Existing Archivo typography, colors, cards, dark mode and search flows remain.
- Removed artificial source latency. Legacy search still uses asynchronous fixture I/O, with early publication checked from the event log rather than the UI throttle.
- Corrected reference-price screening: incomplete history is inconclusive, assortment age must be explicit, exceptions are documented, and legal claims are qualified against the adopted Trade Law amendment.
- Startup scripts now use `node --import tsx`, avoiding the tsx CLI's unnecessary IPC listener. Added API input handling, health endpoint, CI and Docker recipe.

## Validation actually executed

Local environment: macOS, Node 25.9.0; lockfile installation via `npm ci` succeeded.

| Validation | Result |
|---|---|
| Baseline `npm test` | 66 passed |
| Updated `npm test` | 85 passed, 0 failures |
| Focused native engine integration suite | 5 passed, including the strengthened in-flight reallocation assertion |
| `npm run typecheck` | Backend and frontend passed |
| `npm run check` | All 11 retained search checks passed |
| `npm run check:finance` | All scenario checks passed; three-way measured evidence-work overlap 1.522 ms in the recorded run |
| `npm run build` | Production build passed |
| `npm start` | Production server started on localhost:8787 |
| Production HTTP checks | Health, invalid inputs, SSE completion, HTTP 409 cash guard and concurrent idempotent sale retries passed |
| Browser rehearsal | Original 7k plan; blocked early purchase; resale drop; cheaper-offer reallocation; simulated sale/purchases ending at 2k; updated reason/timeline; legacy 60k budget search verified |
| `git diff --check` | Passed |

Tests cover ordinary cash purchases, misleading reference prices and insufficient history, confirmed net proceeds, estimate reductions, cheaper offers, cash/reserve enforcement, unknown delivery, pending/low seller trust, warranty, sale liquidity/deadline, invalid numeric input, duplicate actions, stale commands/results, provider failures, intermediate publication and measurable native-loop overlap. A budget sweep verifies conservation and reserve invariants over hundreds of cases.

`npm run check:finance` saves actual evidence in `data/out/finance-evidence.json` (generated, gitignored). Disk timings vary; the timeline preserves the measured intervals instead of adding delay to make them look longer.

## Preserved components

The old search runtime/contracts, query expansion, multilingual matcher, product catalogue, ranking, source registry, Gigatron implementation, robots/rate-limit/cache utilities, Telegram commands, legacy Black Friday code and original web tools remain. Small adjacent fixes remove source sleeps, handle null API input and prevent incomplete price histories from being asserted as misleading discounts. Mozaik remains exactly 6.0.0; no dependency upgrades were introduced.

## Remaining limits and technical risks

- Since the real-app update, the planner works only from prices the user enters plus catalogue typical prices; it does not fetch live offers. A title is descriptive; explicit fields define the goal, not natural-language parsing.
- This is real concurrent Mozaik execution with asynchronous local I/O offline. Live remote LLM inference was **not** exercised because no provider credentials were configured for this checkout. Provider success/interception/failure paths were tested with controlled HTTP responses. Rehearse `REALDEAL_LLM=1` with a real key before claiming concurrent remote AI execution on stage.
- Model explanations are advisory and can still be inaccurate; the deterministic plan and financial guards remain authoritative. Provider latency/cost requires a live rehearsal. Native 6.0.0 loops have no exposed cancellation handle; submitted requests run until response or the configured HTTP timeout, then stale results are discarded.
- Catalogue sale estimates (50%/40% of typical new price) and the risk thresholds are fixed rules, not calibrated market predictions. No completed-sale dataset is available. Real savings and legal compliance are not verified.
- Plans are saved as JSON files and reload by link, but there is no authentication: anyone with a plan link can change it. No multi-replica coordination, backups or clean-up of old plan files. Bot watches remain in memory.
- Financial strategy is web/API only. Telegram retains search/budget/sell commands; no real bot message was sent during validation.
- Public hosting and Docker image execution were not part of local validation. Hosted CI has since passed on `main`; the container recipe is provided; public deployment remains an explicit later action. The opt-in live adapter was not used in the demo or tested against the real retailer during this change.
- The original search tools retain unknown-delivery display/estimation semantics. Only the new financial strategy fails closed on unknown delivery. Live matcher completion and legacy timeline behavior remain separate from the stronger financial-loop lifecycle.
- No real listings, purchases, payments or commitments were performed.

## Handoff

Branch: [feature/buy-sell-financial-agent](https://github.com/0jz/RealDeal/tree/feature/buy-sell-financial-agent), merged into `main` on November 26, 2026 (`61f66e4`). Hosted CI passed on `main` after the merge.

Run `npm ci && npm run dev` from the repository root. For a production rehearsal, run `npm run build && npm start`. README.md contains the exact three-minute presentation and optional LLM configuration. The primary demo is intentionally small enough to reproduce without accounts or external market services.

## Real-app update (November 26, 2026)

The synthetic strategy data was replaced by user input, so the hosted app shows nothing fake as real:

- Goals now hold the user's own offers (price, delivery, shop, link, warranty, condition) and items to sell (expected price, fees, delivery, days). Names match the catalogue only when unambiguous; the typical price drives hints, savings and a too-cheap-to-be-true check.
- Offer checks block unknown delivery, short warranty and suspiciously low prices; missing shop and non-https links are warnings. Missing sale prices fall back to a labelled low-confidence catalogue estimate.
- The UI is an editable form (up to 5 items each) with an example, plan updates via an `update-goal` command, and "track what you did" actions. The plan id lives in the URL.
- Plans persist to `data/sessions/` and reload after a restart; new plans are rate-limited per IP (20/hour, `TRUST_PROXY=1` behind a proxy).
- `data/strategy/` is no longer read by the code.

Validation: `npm test` 88 passed; typecheck, `npm run check`, `npm run check:finance` and `npm run build` passed; browser check of the example plan (3,600 RSD left), recording a sale, reload after a server restart, and the phone layout.
