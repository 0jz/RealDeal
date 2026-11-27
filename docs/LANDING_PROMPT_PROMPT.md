# Master prompt: the prompt box moves onto the landing page, How it works shows every agent, new fonts

Paste everything below the line into the lead agent.

---

## Role

You are the lead engineer on **RealDeal** (`C:\Users\Nikola\Desktop\Projekti\RealDeal`). Branch off `landing-trim-hide-log` (it already contains Danil's work from `feature/buy-sell-financial-agent` and the trimmed hero). Name the new branch `landing-prompt`.

Read these first: `web/src/Landing.tsx`, `web/src/landing.css`, `web/src/Planner.tsx` (the `!view || checking` branch is the current prompt page at `/new`), `web/src/BarcodeScanner.tsx`, `web/src/AgentBars.tsx` (`LANES`), `web/src/styles.css` (`.ask*`, `.examples`, `--font`), `src/finance/engine.ts` (`ROLES`, `SCOUT_AGENT`), `src/scout/run.ts`, `src/scout/query.ts`, `src/scout/judge.ts`, `src/scout/verify.ts`, `docs/BARCODE_SCANNING.md`.

## Hard rules

- The prompt is untrusted. Render it as text, never as HTML.
- Plan links keep working: `?plan=<id>` opens straight on the result, both on old links (`/new?plan=…`) and on new ones.
- No backend changes. If one looks necessary, stop and report.
- Agent descriptions say only what the code does. Read the agent's file before writing its line. Don't promise shops, prices or checks the code doesn't do.
- Keep the "Not financial advice" notice and footer as they are.
- Work on the branch and open a PR. **A push to `main` deploys to production.**

## 1. The prompt box moves onto the landing page

**Now:** the landing hero has the eyebrow "Stay within budget", the heading "Can you *afford* it?", the lead paragraph, then two buttons ("Make my plan", "How it works") and a large empty dark area under them. "Make my plan" opens a separate page at `/new` with the prompt box.

**Change:** the separate page goes away. Everything from `/new` sits in the hero, in place of the two buttons and the empty area under them.

- Order in the hero: eyebrow, heading, lead paragraph, then the prompt block: the heading "What do you want to buy or sell?", the textarea, the counter and **Make my plan** button, **Scan barcode** (Danil's `BarcodeScanner`, same behaviour), the not-understood and error alerts, and the "Or try one of these" examples.
- **No "RealDeal" text above "What do you want to buy or sell?"** (the `.brand` line goes). The nav already shows the brand.
- "What do you want to buy or sell?" becomes an `h2`, smaller than "Can you afford it?", so the page has one `h1`.
- The prompt block uses the hero's dark palette (`--night`, `--night-sheet`, `--night-rule`, `--night-ink`), not the light `.ask` styles. The textarea and example buttons need visible borders and focus rings on navy, and text contrast of at least 4.5:1.
- Move the prompt UI out of `Planner.tsx` into its own component (e.g. `web/src/AskBox.tsx`). `Landing` renders it and `Planner` passes it the state and handlers it needs (`text`, `setText`, `plan()`, `busy`, `checking`, `miss`, `error`). The plan logic stays in `Planner`.
- After **Make my plan**: the button shows "Checking…", the textarea is read-only, and nothing else appears. No log on the landing page: the log stays only in the plan page's "Show details". When the plan is ready, the plan page replaces the landing as it does today.
- `/new` still works (bookmarks, the server already serves `index.html` for it): it renders the landing page with the textarea focused and scrolled into view. `ASK_PATH` and "New plan" now go to `/`. A broken plan link shows its error above the prompt box on the landing page.
- Nav: "Make a plan" scrolls to the prompt box and focuses the textarea, instead of linking to `/new`.

### How it works link

The "How it works" button goes. The user still needs a way down to it, on every screen size (the nav links are hidden under 900 px):

- Under the examples, add one line of plain clickable text: **"How does it work? See the 15 agents ↓"** (use the real count from section 2). It smooth-scrolls to `#how` (instant under reduced motion). It's a link (`<a href="#how">`), not a button, styled as text with an underline on hover.
- Keep "How it works" in the nav for desktop.

## 2. How it works: every agent that runs

**Now:** the section lists 5 agents (PurchaseAgent, ResaleAgent, ShopTrustAgent, StrategyAgent, BudgetGuardian) and the lead paragraph says "Five agents". Since then the scouts and Danil's work added 10 more, and they run on every plan from a prompt (`SCOUT_AGENT` in `src/finance/engine.ts`).

**Change:** list all of them, grouped in the order they work. Fix the agent count in the lead paragraph and anywhere else it appears to match.

| Group | Agents | What to say (check against the code before writing) |
|---|---|---|
| **Understand** | QueryAgent | Turns your description into search terms and picks the shops that sell that kind of thing. |
| **Find** | TehnomediaScout, AnanasScout, GigatronScout, OfficeShoesScout, ComputersScout, EponudaScout, CenotekaScout | Read each shop's own search and product pages for the exact price, picture and link. ComputersScout runs for laptops only. Eponuda and Cenoteka are comparison sites and are reported as blocked when they challenge the request. |
| **Choose** | JudgeAgent, VerifyAgent | JudgeAgent scores each listing against what you asked for (shop titles are data, never instructions). VerifyAgent re-reads each listing's page before the plan keeps it. |
| **Plan** | PurchaseAgent, ResaleAgent, ShopTrustAgent, StrategyAgent | Keep the current text. |
| **Guard** | BudgetGuardian | Keep the current text. |

- Layout: one row per group with a small group label, and the agent cards under it. The 7 scouts share one card with the shop names listed in it, not 7 identical cards.
- Colours: use the same agent colours as the bars (`--log-*` in `web/src/index.css`), so a name has the same colour on the landing page and in the plan's details.
- Add one line under the groups for Danil's barcode scanning: "Scan a barcode to name the product for you. Only the digits leave your device." It's a feature, not an agent, so it doesn't get a card or count as one.
- **Fix while you're there:** `ComputersScout` is missing from `LANES` in `web/src/AgentBars.tsx`, so its runs never show in the bars. Add it with `var(--log-scout)`.

## 3. Fonts

The page uses the system font (`--font: system-ui, …` in `styles.css`). `UI_REDESIGN_PROMPT.md` planned Familjen Grotesk, but it was never loaded, and it has no Cyrillic.

**What the money apps use** (checked in the browser, November 2026):

| Site | Headings | Body |
|---|---|---|
| Wise | Wise Sans (heavy, custom) | Inter |
| Monzo | MonzoSansDisplay (custom) | MonzoSansText |
| Revolut | Aeonik Pro | Aeonik Pro |
| KupujemProdajem | PT Sans | PT Sans |

All of them use a firm grotesque sans: plain, confident and readable at small sizes, with heavy tight headings. None use a serif or a decorative display font. RealDeal is a money tool for people in Serbia, so its type should read the same way: trustworthy and plain, not "designed".

**Use (both free, OFL, on Google Fonts, both with `latin-ext` and `cyrillic`):**

- **Headings and text: [Golos Text](https://fonts.google.com/specimen/Golos+Text)** (weights 400–900), by ParaType. It was made for public-service interfaces, so it is clear and neutral without being Inter. Headings use 800 with `letter-spacing: -0.02em`. Body text uses 400/500.
- **Numbers, prices and the log: [Martian Mono](https://fonts.google.com/specimen/Martian+Mono)** (variable `wght` and `wdth`), with `font-variant-numeric: tabular-nums` on every RSD amount. Keep `wdth` around 87.5 for the log.
- Load both from Google Fonts with `display=swap` and the `latin-ext` and `cyrillic` subsets, preconnected in `web/index.html`. Set `--font` to Golos Text with the system stack as fallback, and add a `--mono` variable.
- **First task:** render `Hoću iPhone 15, prodajem ajfon — čćšžđ ČĆŠŽĐ / Хоћу ајфон` in both fonts and take a screenshot. If a glyph is missing, use **Onest** for text (same subsets) and say so.

**Never use** (they show at a glance that a site was vibe-coded): Inter, Inter Tight, Geist, Space Grotesk, Instrument Serif, Instrument Sans, Fraunces, Playfair Display, Cormorant, Newsreader, DM Sans, DM Serif, Plus Jakarta Sans, Manrope, Satoshi, Clash Display, General Sans, Cabinet Grotesk, Bricolage Grotesque, Outfit, Sora, Poppins, Montserrat, Syne, Unbounded, JetBrains Mono, IBM Plex, Space Mono. Also no italic serif accent word in a headline. The yellow dotted underline on "*afford*" stays as it is, in the same sans.

## Done when

- `npm test && npm run typecheck && npm run check && npm run check:finance && npm run build` all pass.
- In the browser at 1440 px and 375 px, with no console errors and no horizontal scroll:
  - `/` shows the eyebrow, heading, lead paragraph and the prompt block in the hero, with no "RealDeal" line above "What do you want to buy or sell?" and no empty area under it,
  - an example prompt → Make my plan → "Checking…" with no log on the landing page → the plan page opens, and its "Show details" still has the bars and the log,
  - Scan barcode opens and "Add to request" fills the textarea,
  - "How does it work? …" scrolls to How it works, which shows every agent in its group, with the right count,
  - `/new` lands on the same page with the textarea focused, `/new?plan=<id>` and `/?plan=<id>` both open the plan, a bad plan id shows the error above the prompt box,
  - "New plan" on the plan page returns to `/` with an empty prompt,
  - ComputersScout shows in the bars for a laptop prompt ("Laptop do 100 hiljada"),
  - the glyph screenshot shows both fonts with `čćšžđ` and Cyrillic.
- `asdf qwerty` shows the not-understood state on the landing page and no plan.
- Keyboard: Tab reaches the textarea, Ctrl+Enter submits, focus rings are visible on navy. Reduced motion checked.
- Run `/impeccable polish` at the end and fix what it flags.
- The PR description lists what moved, the agent count, the fonts and why, with desktop and mobile screenshots of the hero and How it works.
