# Master prompt: live bars, tidier result, best-product card

Paste everything below the line into the lead agent (Opus). It plans, hands coding tasks to Haiku and OpenCode agents, checks every result and puts the pieces together.

---

## Role

You are the lead engineer on **RealDeal** (`C:\Users\Nikola\Desktop\Projekti\RealDeal`), branch `ui-redesign`. You plan, write task briefs, check every result and integrate. You do the layout and anything that touches money labels yourself. Coding tasks go to **Haiku** and **OpenCode agents** (see the table at the end).

Read these first: `docs/UI_REDESIGN_PROMPT.md` (the theme, fonts and motion rules still apply), `web/src/Planner.tsx`, `web/src/LiveLog.tsx`, `web/src/Finance.tsx` (`PlanResult`, `ExecutionTimeline`), `web/src/Landing.tsx` (`SiteNav`), `src/finance/engine.ts`, `src/finance/types.ts`, `src/sources/gigatron.ts`.

## Hard rules

- Every price keeps its label. A listing price says which shop and when it was checked. A catalogue price says "typical price (estimate)". Nothing fake is shown as real: fixture listings (URLs containing `/fixture/`) are never shown as a real product link.
- No fake agent activity. Bars show the real intervals from `view.runs`. No artificial delays beyond the existing ~600 ms hold after the agents settle.
- The prompt is untrusted. Render it as text, never as HTML.
- `?plan=` links still open straight on the result, with no replay.
- Backend changes are limited to the three listed below (`queuedMs`, listing `image`, and nothing else). Anything more: stop and report.
- Work on a branch and open a PR. **A push to `main` deploys to production.**

## 1. Live bars while the agents check

**Now:** after "Make my plan", `LiveLog` streams text lines.
**Change:** while `phase === "checking"`, show the agent bars instead of the text lines.

- Build `web/src/AgentBars.tsx` from `ExecutionTimeline` in `Finance.tsx`: one lane per agent (PurchaseAgent, ResaleAgent, ShopTrustAgent, StrategyAgent), using the `--log-*` agent colours from `LiveLog.tsx`.
- **Running bars grow:** a `running` run is drawn up to "now" and redrawn every animation frame (`requestAnimationFrame`, stopped when everything has settled or on unmount). Finished bars keep their real start and end.
- The x axis covers the current cycle, from the first start to `max(now, last end)`. Show the real total under the bars: "4 agents · 2.4 ms".
- **Short runs:** in offline mode the whole check takes about 2–3 ms, so it is already finished when the first frame paints. In that case, during the existing 600 ms hold, sweep a playhead left to right over the real intervals so the user sees the order the agents ran in. The label still shows the real duration. Under reduced motion, show the final bars with no sweep.
- Keep the row of agent status dots (waiting / checking / done) above the bars.
- Status colours: accepted = agent colour, running = agent colour with the pulsing dot, stale = ochre (`--warn`) with the label "discarded: the plan changed while it ran", error = red.

## 2. The StrategyAgent gap (diagnosed, fix it)

**What the user sees:** in the StrategyAgent lane, a yellow bar, then empty space, then a small green bar.

**Why, measured on a real run** (offline mode, times in ms from the first start):

```
PurchaseAgent   accepted   0.000 → 0.599
ResaleAgent     accepted   0.187 → 1.052
ShopTrustAgent  accepted   0.309 → 1.358
StrategyAgent   stale      0.430 → 1.731   ← yellow
StrategyAgent   accepted   2.327 → 2.352   ← green, 0.6 ms later
```

- **The yellow bar** is the first StrategyAgent run. `commandGoal`/`createGoal` launch it together with the three evidence agents, so it works on the plan before any evidence is in. Each evidence result bumps the revision, so that run comes back stale and is discarded (yellow = `.execution-bar.stale`). Its result is queued for a rerun.
- **The gap** is queue time. When the stale run finishes, `launch()` starts a new StrategyAgent run right away and sets `startMs`. But `runner.run()` overwrites `startMs` (`engine.ts`, top of `runner.run`) when the Mozaik loop actually reaches inference, about 0.6 ms later. The bar starts at that second time, so the wait between the two runs is drawn as nothing. On a 2.4 ms axis, 0.6 ms is a quarter of the width.
- **The green bar is small** because the real StrategyAgent work is pure arithmetic (~0.03 ms).

**Fix (small backend change, allowed):**

- `src/finance/types.ts`: add `queuedMs: number` to `AgentRun`.
- `src/finance/engine.ts`: in `launch()`, set `queuedMs` with the same `performance.now()` as `startMs`. Leave the overwrite in `runner.run` alone, so `startMs` stays "inference started".
- In the bars, draw `queuedMs → startMs` as a thin hatched segment in the lane colour, with the tooltip "waiting for its turn". The StrategyAgent lane then reads: yellow (discarded), hatched (waiting), green (final). No empty gap.
- Old saved plans have no `queuedMs`: fall back to `startMs`.
- Add a test in `src/finance/engine.test.ts`: after a prompt plan settles, every run has `queuedMs <= startMs`.

## 3. The result page: what moves where

Order on the result page, top to bottom:

1. **Header (`SiteNav`):** RealDeal · **Track what you did** · **Share** · New plan
2. **The plan** (section 4 below), the scroll target.
3. **Details panel** (the old collapsed log), closed by default.
4. Footer.

`SiteNav` takes one `action` today. Change it to accept several (`actions?: ReactNode`) and keep the landing page working.

### Share (replaces "Come back later")

- A **Share** button in the header, shown only when a plan is on screen (not on the landing or prompt page).
- Click: copy the plan URL, then a sonner toast: "Link copied. Anyone with this link can see and change this plan."
- If `navigator.share` exists (mobile), use it instead of copying.
- Delete the "Come back later" section.

### Track what you did (a popup, not a section)

- A header button **Track what you did** opens a shadcn `dialog` with the current Track content: mark a sale, mark a purchase (with the amount paid when the price was an estimate), set cash aside / release it.
- Toast on save. The dialog stays open after a save so several things can be recorded.
- Delete the in-page "Track what you did" section.

### Details panel (the old log, now holding "What I understood")

Put "What I understood" and "Edit details" **inside** the collapsed log, **before** the agent activity. Reason: they are the input; the agents checked that input; reading top to bottom then follows cause and effect.

The collapsed one-liner stays: "4 agents checked your plan in 2.4 ms · Show details". Opened, it contains in this order:

1. **What I understood:** the existing chips with their popovers (swap product, your price, remove). Then **Edit details** as a `collapsible` (the full `FinanceForm`), closed by default.
2. **How the agents checked this plan:** the `AgentBars` from section 1 (final state, with the cycle picker from `ExecutionTimeline`), then the text log lines from `LiveLog`, then "What changed" (`view.history`).

Remove the old standalone "What I understood" section, the "Edit details" button row, and the separate "How the agents checked this plan" `<details>` at the bottom.

A chip change still re-plans through `update-goal` and scrolls back to the plan.

## 4. The plan section ("Buy what fits now")

**One number only for now: what the product costs.**

Remove:

- the four metrics (cash you can spend, expected from sales, planned purchases, left after),
- the "Updated 12:04:31" tag and the `view.reason` line ("Goal updated; checking again", "… updated the evidence"),
- `wait` actions from the action list,
- the StrategyAgent note ("You can pay from the cash you have…"),
- the **Offer checks** and **Money so far** `<details>`.

Headline: keep the existing logic, but "Buy what fits now. Wait on the rest." becomes "Buy what fits now."

### The best result card (one per thing to buy)

- **Picture:** large, about 240 px on desktop, full width on mobile, `object-fit: contain` on the sheet colour.
- **Product name:** large (the section heading size from the theme).
- **The main number:** the exact price of the best listing, in Martian Mono with NumberFlow. Under it, the label: "at Gigatron · checked 12:04" (or "typical price (estimate)" when there is no listing).
- **Link:** "Open at Gigatron ↗" to the exact product page (`target="_blank" rel="noopener noreferrer nofollow"`).
- **No listing found:** the catalogue typical price with "typical price (estimate)", no link, and a neutral placeholder instead of the picture (the category's lucide icon on the sheet colour). Never a stock photo.
- If the plan says to sell something first, one plain line under the card: "Sell your iPhone 13 first." No amount.

### Next best 4

Under the card, a row (2×2 on mobile) of the 4 next products from `kept.alternatives[wish.id]` (`choose.ts` already returns up to 4). Each shows a small picture, name and price, labelled the same way as above. Clicking one swaps it in with the existing `update-goal` swap from `WishEditor`.

### Where the pictures and exact prices come from

The data doesn't have them yet:

- The finance catalogue (`/api/products`) has only `id, name, brand, category, typicalPrice`.
- Search listings (`src/search`) have `url` and `price` but no image.
- The fixtures (`data/fixtures/*.json`) have fake URLs.

Do this:

1. **Backend (allowed):** add `image?: string | null` to `RawListing` and the ranked listing type in `src/search/types.ts`. In `src/sources/gigatron.ts` `parseProduct`, read the JSON-LD `image` (a string, or the first item of an array; keep only `https:` URLs). Pass it through the matcher/ranker. Fixtures stay `null`. Add a unit test in `src/sources/gigatron.test.ts` with an image in the JSON-LD.
2. **Frontend:** for each wish and each of the 4 alternatives, run the existing search (`POST /api/search` with the product name as the query, then follow its stream via `web/src/stream.ts`). From the finished result, take the cheapest real `shop` listing by `total` that matches the product. Cache by product id for the page's lifetime. Searches run after the plan is shown; the card shows a skeleton for the picture and price until they finish.
3. Respect the server's limit on concurrent searches (it returns 429): run at most 2 at a time.

If the search for a product finds no real listing, use the "no listing found" state above.

## Agents: who does what

Every brief names the files the agent owns, what done looks like, and the check command. Agents never edit files outside their list.

| Agent | Tasks | Why |
|---|---|---|
| **Lead (Opus, you)** | the plan, every brief, `Planner.tsx` layout and the order of sections, the details panel, money labels on the card, integration, final review | layout and honesty of the numbers need the strongest model |
| **Haiku (coding)** | **H1** `queuedMs` in `types.ts` + `engine.ts` + test · **H2** `SiteNav` multiple actions + Share button + toast · **H3** Track dialog (move the existing JSX into `dialog.tsx`) · **H4** removals in `PlanResult` (metrics, tag, reason, wait, note, Offer checks, Money so far) · **H5** gigatron `image` + test · **H6** browser checks: screenshots at 1440 px and 375 px, console errors | each is under ~150 lines with an exact spec, so the brief does the thinking |
| **OpenCode agents (GLM or another non-Anthropic model)** | **O1** `AgentBars.tsx`: live bars, rAF redraw, playhead sweep, hatched queue segment · **O2** `BestPick.tsx`: the best result card + next best 4 + skeletons · **O3** `useListings` hook: search per product, 2 at a time, cache, picks the cheapest real listing · **O4** second-model review of the finished PR | bigger self-contained frontend pieces that can run in parallel, and a different model catches different mistakes in review |

**Order:**

1. **Haiku H1, H5** (backend, in parallel).
2. **Lead:** the new section order in `Planner.tsx` with placeholders, and the props each new component takes. Write them into the O1–O3 briefs.
3. **In parallel:** O1, O2, O3, H2, H3, H4.
4. **Lead:** integrate, then the details panel (What I understood + Edit details + bars + log).
5. **Haiku H6:** browser checks.
6. **OpenCode O4:** review.
7. **Lead:** fix what the review and checks found, open the PR.

If an agent's result fails its check twice, the lead takes the task over. Don't send it out a third time.

## Done when

- `npm test && npm run typecheck && npm run check && npm run check:finance && npm run build` all pass.
- In the browser at 1440 px and 375 px, with no console errors and no horizontal scroll:
  - an example prompt → bars draw (playhead sweep in offline mode) → the plan opens and scrolls into view,
  - the StrategyAgent lane shows yellow → hatched → green with no empty gap,
  - the plan shows one number per product, a large picture (or the placeholder), the exact-price link, and 4 next-best products; clicking one swaps it,
  - none of the removed items appear (metrics, updated tag, reason line, wait, cash note, Offer checks, Money so far, Come back later, the in-page Track section),
  - Share copies the link with a toast; Track opens as a dialog and recording a sale updates the plan,
  - Show details opens What I understood (chips, Edit details), then the bars, the log and What changed,
  - reloading the copied link opens straight on the result.
- The nonsense prompt `asdf qwerty` shows the not-understood state and no plan.
- Dark mode and reduced motion both checked.
- Run `/impeccable polish` at the end and fix what it flags.
- The PR description lists the backend changes (`queuedMs`, listing `image`) and why, with screenshots of the bars, the plan card and the details panel (desktop and mobile).
