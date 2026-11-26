# Master prompt: RealDeal UI redesign (Vite + shadcn/ui)

Paste everything below the line into the lead agent (Opus). It plans the work, hands tasks to sub-agents and puts the pieces together.

---

## Role

You are the lead engineer and designer on **RealDeal** (`C:\Users\Nikola\Desktop\Projekti\RealDeal`). You plan, assign tasks to sub-agents, check every result, and put it together. You write the shared parts yourself: the design tokens and the page layout.

Read these first: `README.md`, `docs/PROMPT_PLAN.md`, `web/src/Planner.tsx`, `web/src/Finance.tsx`, `web/src/Timeline.tsx`, `web/src/stream.ts`, `web/src/styles.css`.

## Goal

Rebuild the web UI on **Vite + React + Tailwind v4 + shadcn/ui** with a new theme and a new flow:

1. **Front page:** one prompt, one button.
2. Press the button and a **live log** shows the agents checking.
3. When the agents finish, the result appears and the page **scrolls itself** to **"You can afford it"**.
4. Below that, in this order, each a scroll further down:
   - **Track what you did**
   - **Come back later**
   - **What I understood** (at the very bottom)

## Hard rules (unchanged from PROMPT_PLAN.md)

- **Don't touch these:** the backend, `src/finance/*`, the API and the SSE events. This is UI work only. If the UI needs a field the API doesn't have, stop and report it. Don't add it yourself.
- Every price keeps its label: "your price" or "typical price (estimate)". Nothing fake is shown as real.
- The prompt is untrusted. Render it as text, never as HTML.
- `?plan=` links still restore the plan, the records and the result view, with no log replay. A reloaded plan opens straight on the result.
- Work on a branch and open a PR. **A push to `main` deploys to production.**

## Stack

- **Already in place:** Vite 7 and React 19. Keep them.
- **Add:** Tailwind CSS v4 (`@tailwindcss/vite`), then run `npx shadcn@latest init` for Vite, with the `@/` alias in both `web/tsconfig.json` and `web/vite.config.ts`.
- **shadcn components:**
  - `button`, `textarea`, `input`, `card`, `badge`, `popover`, `command` (the product swap picker), `scroll-area` (the log), `separator`, `skeleton`, `sonner` (toasts for "link copied", "saved"), `tooltip`, `collapsible` ("Edit details").
- **Extras, worth adding:**
  - `motion` (the Framer Motion package): the log entering, the result revealing, the stagger.
  - `lucide-react`: icons.
  - `@number-flow/react`: animated money figures when the plan changes.
  - That's all. Every other dependency needs a reason written in the PR.
- **Retire `styles.css` as you go.** The final build must not load two design systems.
- **Remove shadcn's default font.** Use only the fonts below.

## Theme: "Receipt & Banknote"

The app is about money you actually have, so it should look like a clean bank receipt: warm paper, dark ink, a green you can trust, and one sharp accent for "live" and the main call to action.

| Role | Name | Hex | Used for |
|---|---|---|---|
| **Main** | Banknote green | `#145C43` | primary button, "you can afford it", buy actions, focus ring |
| **Secondary** | Ledger ink | `#1B2433` | text, dark surfaces, the log panel background |
| **Accent** | Price-tag tangerine | `#F26A1B` | the live log's pulsing dot, active agent, hover on the main button, highlights; at most one accent element on screen at a time |
| Paper | Receipt paper | `#F6F3EC` | page background |
| Sheet | — | `#FFFDF8` | cards |
| Rule | — | `#E2DCCF` | dividers, dashed "tear" lines between sections |
| Muted text | — | `#6B6F76` | labels, notes |
| Block | — | `#C21F32` | blocked offer, refused purchase |
| Warn | — | `#B7861F` | warnings, estimates; ochre, so it isn't confused with the accent |

- Map these onto the shadcn CSS variables in `web/src/index.css`: `--primary`, `--secondary`, `--accent`, `--background`, `--card`, `--border`, `--ring`, `--destructive`, `--muted-foreground`, and add `--warn`.
- **Dark mode:** paper `#12161D`, sheet `#1A2029`, ink `#ECE7DC`, green lifted to `#3FA37A`, tangerine kept.
- Check contrast to WCAG AA. Tangerine on paper fails for small text, so use it only on large text, icons and fills.

## Fonts

None of the fonts Claude uses, and no Inter, Geist or Archivo. Both fonts are free (OFL) on Google Fonts.

- **Display and body: [Familjen Grotesk](https://fonts.google.com/specimen/Familjen+Grotesk)** (variable weight, 400–700). A Swedish grotesk with tight, slightly quirky shapes, friendly but not soft. Use it for headings, the prompt and the body text.
- **Numbers and the log: [Martian Mono](https://fonts.google.com/specimen/Martian+Mono)** (variable weight and width). It supports Latin Extended and Cyrillic, so Serbian `č ć š ž đ` works and Cyrillic does too. Use it for every RSD amount (`font-variant-numeric: tabular-nums`), the live log lines, badges and timestamps. A slightly condensed width (`wdth` around 87.5) suits the log.
- Load both from Google Fonts with `display=swap` and the `latin-ext` subset.
- **First task:** render `Hoću iPhone 15, prodajem ajfon — čćšžđ ČĆŠŽĐ` in both fonts and screenshot it. If Familjen Grotesk is missing any of those glyphs, switch the display font to **Onest** (Latin Extended and Cyrillic) and say so.
- **Type scale:**
  - prompt text 22–28px
  - section headings `clamp(28px, 4vw, 44px)`, weight 700, letter-spacing −0.02em
  - body 16px
  - log 13px mono

## Pages and sections

### 1. Front page

- Full viewport and centred: a short headline, one sentence of tagline, a large textarea (the prompt), a budget input in mono, and a primary button **"Make my plan"**.
- **Under the box:** the 3 existing example prompts as chips. Clicking one fills the box, but doesn't submit.
- **Background:** a faint receipt-paper texture (a CSS noise or dotted pattern, nothing that moves), and a perforated edge at the bottom of the card. No purple, no gradient blobs, no icon tiles above headings, no cards inside cards.
- **Desktop:** headline on the left, prompt card on the right, or stacked; your call, but commit to one.
- **Mobile (375px):** stacked, 16px side gutter, no horizontal scroll.

### 2. Live agent log (right after the button is pressed)

- The button changes to a working state, and a **dark ink panel** (the log) slides down under the prompt (200ms, ease-out).
- It streams the real SSE events from `web/src/stream.ts`. **No fake lines and no artificial delays.** If the run finishes in 40ms, the log fills in 40ms, then waits about 600ms so it can be read.
- **One line per event:** `12:04:31.204  ResaleAgent   valued iPhone 13 (good) → 30.000 RSD · estimate`.
  - The agent name is in a fixed-width column and colour-coded per agent (reuse the existing lane colours, adjusted to the palette).
  - Show a tangerine pulsing dot on the agent that is still running and a check mark when it's done.
- **Above the lines:** a compact row of the 5 agents (PurchaseAgent, ResaleAgent, ShopTrustAgent, StrategyAgent, BudgetGuardian), each showing *waiting / checking / done*.
- **Auto-scroll:** the log follows new lines (`scroll-area`), unless the user has scrolled up in it.
- **Errors:** if the request fails or returns 422 (nothing matched), the log shows a red final line and the "not understood" words, the example chips come back, and the page doesn't scroll.

### 3. Result reveal

- **When the stream says done:**
  - the log collapses into a one-line summary, "5 agents checked in 0.4 s · show log", which can be opened again,
  - the result fades and slides up (250ms, items staggered 30ms apart),
  - the page **smooth-scrolls to "You can afford it"**.
- **Respect `prefers-reduced-motion`:** with it on, nothing animates and the page jumps instead of scrolling smoothly.

### 4. "You can afford it" (the scroll target)

- The headline comes from the existing logic: "You can afford all of it now." / "Sell first, then buy." / "Buy what fits now. Wait on the rest." Make it big.
- **Directly under it:** "Left after" in mono with NumberFlow, then the action list styled like receipt lines:
  - `SELL` / `BUY` / `WAIT` in mono caps,
  - the item name,
  - the amount right-aligned,
  - the price-source badge.
- **Between sections:** a dashed tear line.

### 5. Track what you did (needs a scroll; not visible on arrival)

- Leave 40–60vh of empty space above it, so it starts below the fold on a 900px-tall screen after the scroll to section 4.
- Keep the existing behaviour: mark a sale or a purchase, and enter the price actually paid when the price was an estimate. Use shadcn `card` and `input`, and show a toast when it's saved.

### 6. Come back later (directly below Track)

- The plan link in a read-only mono field with a **Copy** button (sonner toast "Link copied").
- One line: "Anyone with this link can see and change this plan."
- Optionally, if the browser supports it, an "Add to calendar" reminder (`.ics` download). Skip it if it adds more than about 30 lines.

### 7. What I understood (very bottom)

- The existing chips. Each opens a `popover` with:
  - a `command` list to swap the product (same category),
  - a price input (it becomes "your price"),
  - a remove button.
- A change re-plans through `update-goal`. The page then scrolls back up to section 4 with the new numbers (NumberFlow animates them).
- **"Edit details"** (the full Finance form) sits here as a `collapsible`, closed by default.

## Motion

- Entrances use ease-out, 150–300ms. Exits are about 20% shorter.
- Popovers start at scale 0.95, from their trigger. Buttons press to 0.97.
- Stagger list items 30ms apart. No springy bounce.
- Every animation can be interrupted and respects `prefers-reduced-motion`.

## Agents: who does what

Give each sub-agent a task brief with: the files it owns, what done looks like, and the check command. Sub-agents never edit files outside their list.

| Agent | Use it for | Why |
|---|---|---|
| **Lead (Opus, you)** | the plan, the design tokens (`index.css`), the page layout and scroll choreography, merging, the final review | taste and integration need the strongest model |
| **Haiku coding agents** | small tasks with exact specs: installing and initialising Tailwind/shadcn, adding each shadcn component, swapping fonts, converting one existing section to shadcn markup, writing the `.ics` helper, running `npm run typecheck`/`build`, and the browser checks (screenshots at 1440px and 375px, console errors) | fast and cheap. Each task is under ~150 lines with a known shape, so the brief does the thinking |
| **GLM agents (via OpenCode)** | **(1)** larger independent UI pieces that can run in parallel while Haiku does setup, e.g. the whole live-log component (`web/src/LiveLog.tsx`) and the receipt-style result list; **(2)** a **second-model review** of the finished PR (a different model catches different mistakes); **(3)** bulk mechanical passes over many files, e.g. moving every `styles.css` class to Tailwind utilities, where a long context and low cost matter more than taste | good at frontend code, cheap for long outputs, and a useful outside view. Don't use it for the design tokens, the scroll choreography or anything touching money labels |

- **Order:**
  1. **Haiku T1:** Tailwind + shadcn init + fonts + glyph screenshot.
  2. **Lead:** tokens + layout skeleton.
  3. In parallel:
     - **GLM:** LiveLog
     - **GLM:** ResultReceipt
     - **Haiku:** Track / Come back / Understood conversions, one agent each
  4. **Lead:** integration + scroll choreography.
  5. **Haiku:** browser verification.
  6. **GLM:** review.
  7. **Lead:** fix + PR.
- If a sub-agent's result fails its check twice, the lead takes the task over. Don't send it out a third time.

## Done when

- `npm test && npm run typecheck && npm run check && npm run check:finance && npm run build` all pass.
- The following works in the browser at 1440px and 375px, with no console errors and no horizontal scroll:
  - example prompt → live log streams the real events → result → auto-scroll lands on "You can afford it"
  - scroll down → Track → Come back later (copy the link) → What I understood
  - swap a product → the numbers update
  - reload the copied link → the result opens directly, with the records kept
- The nonsense prompt `asdf qwerty` shows the not-understood state and no plan.
- Dark mode and reduced motion both checked.
- Run `/impeccable critique` before integration and `/impeccable polish` at the end. Fix what it flags.
- The PR description lists the dependencies added and why, plus screenshots of each section (desktop and mobile) and the font glyph check.
