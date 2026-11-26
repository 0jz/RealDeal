# JDI — Black Friday AI Hackathon Project Brief

> Context file for Claude Code. Read fully before writing code.
> Team: **JDI (Just Do It)** · Tagline: **"No fake discounts. Just do it."**
> Scope: **BUYER SIDE ONLY.** No merchant/platform fraud, no chargebacks, no payments.

---

## 1. The hackathon (hard constraints)

- **Event:** JigJoy Black Friday AI Hackathon, 26–27 Nov 2026 (on-site at NTP Beograd, or online).
- **Track:** AI agents in finance / fintech (we're in personal finance + checkout).
- **Deadline:** submissions close **Fri 27 Nov, midnight CET**. Demos Fri 17:00–19:00.
- **MUST use Mozaik** (`@mozaik-ai/core`), JigJoy's TypeScript runtime for concurrent agents.
  - Use the official starter template / docs we received (docs.jigjoy.ai, github.com/jigjoy-ai/mozaik, github.com/jigjoy-ai/mozaik-examples). **Do not guess the Mozaik API — read the docs/examples first.**
- **MUST run 2+ agents concurrently.** Single-agent projects aren't judged.
- **Judging:** genuine concurrency (main weight) · technical execution · creativity · clarity of submission.
  - Judges penalize "a sequential pipeline in disguise." Fan-out → wait → aggregate also looks weak.
- **Data:** synthetic or public only. No real accounts, no real money movement.
- **Substance must be built during the event** (boilerplate/libraries OK). AI assistance is allowed.
- **Submission:** project name, accessible repo, description, **explanation of how agents run concurrently**. Strongly recommended: demo video, live deployment, screenshots. Judges must be able to open/run it.

---

## 2. The product

**Problem:** On Black Friday, Serbian shops inflate prices before the sale and then show a fake "discount." Since **1 May 2026**, Serbia's new consumer protection law has a **30-day rule**: the advertised "previous price" must be the **lowest price the shop offered in the 30 days before the sale** (or at least 15 days for products in stock less than 30 days). Shoppers have no easy way to check this, or to see that the same item is cheaper on KP (KupujemProdajem).

**Solution:** A live buyer-side agent swarm. Users add products to a watchlist. While a Black Friday price feed streams in, concurrent agents keep checking every product for fake discounts (30-day rule), KP market price, and cross-shop price, and each item's verdict updates live: **REAL DEAL / FAKE DISCOUNT / BUY ON KP INSTEAD / WAIT**.

**Why the Balkans / buyer-only:** online shopping here relies heavily on cash on delivery, so the real pain is fake discounts and overpaying, not chargebacks.

---

## 3. Agents (all concurrent, event-driven on the shared Mozaik environment)

Each agent **subscribes to events and reacts on its own**. No agent waits for another to finish. Findings are published as events that other agents can react to.

| Agent | Listens to | Does | Emits |
|---|---|---|---|
| **PriceFeed** (simulator, not LLM) | timer | Streams synthetic Black Friday price changes for many SKUs across shops, including planted fake discounts (pre-sale hikes) | `price.changed` |
| **ThirtyDayAgent** | `price.changed` | Computes the real lowest price in the last 30 days (15-day rule for new items), compares it to the shown "previous price", flags likely violations with evidence | `discount.verified` / `discount.fake` |
| **KPMarketAgent** | `price.changed`, `watchlist.added` | Looks up the same model in the KP snapshot (new/sealed vs used), estimates market price | `kp.price` |
| **CrossShopAgent** | `price.changed` | Compares the same SKU across other shops | `crossshop.best` |
| **ShopTrustAgent** | `discount.fake` | Keeps a per-shop trust score. When a shop gets caught, it **downgrades every product from that shop** | `shop.trust.changed` |
| **DealHunterAgent** | runs continuously | Scans all shops + KP for real deals that aren't on the watchlist | `deal.found` |
| **VerdictAgent** (LLM for explanation) | all of the above | Keeps a live verdict per product and recomputes it whenever any input arrives. Uses an LLM only for the short plain-language explanation | `verdict.updated` |

**Concurrency moments to show in the demo:**
1. Price spike → ThirtyDay, KP, and CrossShop agents all fire at the same time on the same event.
2. ThirtyDay catches shop X → ShopTrust downgrades shop X → verdicts for **all** shop X products flip at once.
3. KP agent finds a cheaper sealed listing mid-run → verdict flips to "BUY ON KP INSTEAD".
4. DealHunter keeps posting deals while everything else is busy.

**Implementation notes:**
- Shared state: price history per (shop, SKU), watchlist, shop trust, verdicts.
- Log every event with a timestamp + agent name → used for the timeline UI and the concurrency write-up.
- Keep scoring **rule-based** (fast, cheap, deterministic). LLM calls only in VerdictAgent explanations (and optionally fuzzy KP title matching). Cache/debounce LLM calls.

---

## 4. Data (synthetic / public only)

- **Shops:** 4–5 fictional or clearly synthetic Serbian electronics shops (avoid presenting synthetic data as real shops' behavior).
- **Products:** ~30–50 SKUs (phones, laptops, consoles, TVs, headphones), prices in RSD.
- **Price history generator:** 60 days of history per (shop, SKU). Plant patterns:
  - honest discount
  - pre-sale hike then "−40%" (fake)
  - "previous price" shown higher than any real price in 30 days
  - new-in-stock item (15-day rule case)
  - tiny "discount" of a few dinars
- **KP snapshot:** JSON of KP-style listings (title, price, condition: new/sealed/used, city). Use a small public snapshot or synthetic KP-style listings. **No live scraping during the demo.**
- Seeded RNG so the demo is reproducible.

---

## 5. UI (one page, live)

- **Watchlist grid:** product cards showing shop price, real 30-day lowest, KP price, a verdict badge, and a one-line explanation. Cards animate when the verdict changes.
- **Live agent timeline** (the concurrency proof): lanes per agent with events appearing in real time and overlapping. This is the hero of the demo.
- **Shop trust panel:** shops with trust scores dropping live.
- **Deal feed:** DealHunter finds.
- **Controls:** "Start Black Friday" (starts the feed), "Speed ×10", "Inject fake discount".
- Push updates via SSE or WebSocket from the Mozaik backend.

Suggested stack: Node + TypeScript backend with Mozaik, a small HTTP + SSE server, and a React/Next or Vite frontend. Keep it deployable (e.g., Vercel for the frontend + a small Node host, or a single Node server serving both).

---

## 6. Out of scope (do NOT build)

- Merchant/platform fraud, chargebacks, escrow, payments, card optimization
- Real KP scraping in the live demo, user accounts, auth
- Browser extension (mention it as "next step" in the pitch only)

---

## 7. Build order

1. **Setup (first hour):** Mozaik starter running, 2 dummy agents reacting to the same event concurrently. Confirm the event/participant API from the docs.
2. Synthetic data generator (shops, SKUs, 60-day history with planted fakes, KP snapshot).
3. PriceFeed + ThirtyDayAgent + VerdictAgent → first end-to-end loop.
4. KPMarketAgent + CrossShopAgent.
5. ShopTrustAgent (cascade moment) + DealHunterAgent.
6. Event log → SSE → UI (timeline first, then cards).
7. LLM explanations in VerdictAgent.
8. **Friday:** polish, README, concurrency write-up, demo video, deploy, submit **well before midnight**.

---

## 8. Submission checklist

- [ ] Repo public / accessible to judges, with a one-command run (`npm i && npm run dev`) and a `.env.example`
- [ ] README: problem, the 30-day rule, architecture diagram, agent table
- [ ] **"How agents run concurrently"** section: event-driven participants, no central scheduler, cascade examples, a screenshot of overlapping timeline lanes + timestamps from the logs
- [ ] Demo video (~2–3 min): start Black Friday → parallel firing → shop caught → cascade → KP flip
- [ ] Live deployment link
- [ ] Screenshots
- [ ] Note that all data is synthetic or public

---

## 9. Pitch (3 min)

1. Hook: "Last Black Friday you probably bought a fake discount. Since May, that's illegal in Serbia, but nobody checks."
2. Live demo of the swarm.
3. Why concurrency matters: prices change every second, so the agents have to react in parallel, not in turns.
4. Next steps: browser extension, real shop price feeds (the law requires retail chains to publish daily price lists on the open data portal), KP integration.
