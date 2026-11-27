# Live laptop search check

Checked: 2026-11-27 14:33:39 CET.

Request: `ноутбук до 100к`, through `createGoalFromPrompt` and the real shop registry (`REALDEAL_LLM=0`). No fixture or injected shop responses.

Result: 9 real product cards, 3 in each fixed third of 100,000 RSD. All nine prices were fetched again before acceptance. Six offers have affirmative stock data; the three budget offers do not. **This is not a confirmation that all nine can be delivered.**

| Tier | Range (RSD) | Example | Price (RSD) | Stock |
| --- | --- | --- | ---: | --- |
| budget | 1–33,333 | [MEDIACOM SmartBook SB142 14 FHD Intel Atom x5-Z8350 Quad Core 1.44GHz (1.92GHz) 4GB 32GB eMMC Windows 10 Home 64bit srebrni](https://www.computers.rs/artikal/mediacom-smartbook-sb142-14-fhd-intel-atom-x5z8350-quad-core-144ghz-192ghz-4gb-32gb-emmc-windows-10-home-64bit-srebrni) | 25,990 | unknown |
| mid | 33,334–66,666 | [Asus Laptop Vivobook 15 X1504VA-BQ4358, 15.6", FHD, Core 3 100U, 8 GB, 512 GB SSD, Teget](https://ananas.rs/proizvod/asus-laptop-vivobook-15-x1504va-bq4358-15-6-fhd-core-3-100u-8-gb-512-gb-ssd-teget/7298083) | 37,999 | confirmed by shop |
| top | 66,667–100,000 | [HP OmniBook 3 16-by0010nm, 16" WUXGA, AMD Ryzen 5 40, 16GB, 512GB, DOS, plava (D92NGEA)](https://www.tehnomedia.rs/proizvod/hp-omnibook-3-16-by0010nm%2C-16--wuxga%2C-amd-ryzen-5-40%2C-16gb%2C-512gb%2C-dos%2C-plava--d92ngea-) | 70,999 | confirmed by shop |

The budget cards are old entry-level models (Atom/Celeron, 4 GB RAM; the cheapest has only 32 GB eMMC). They are not presented as equivalent in capability to the middle/top models. Computers.rs exposes ordering buttons but no stock assertion, so its availability remains unknown. Delivery is also unknown for Computers.rs and the Ananas example and is excluded from the displayed total; Tehnomedia reports zero delivery for these offers. Several laptops have DOS/no Windows licence.

Ananas and Tehnomedia’s own laptop categories start above the first band (37,999 and 43,999 RSD respectively at this check). Computers.rs supplies actual lower-price cards, rather than moving tier boundaries or using example prices. In equally relevant results, confirmed stock now takes priority over lower prices with unknown availability. The overall first choice in this run is the 37,999 RSD Asus Vivobook.

Sources read: Ananas 20 product pages, Tehnomedia 20, Computers.rs 20, plus fresh checks of the nine selected products. eponuda and Cenoteka returned 403 and remain explicitly blocked. Gigatron and Office Shoes remain disabled.

Fixes:

- Use the deepest recognized shop category and its refinements: neither the broad equipment ancestor on Ananas nor Home & Office beneath Laptopovi on Tehnomedia prevents laptop matches.
- Accept laptop models without the word laptop in their title, while keeping model constraints and rejecting batteries, bags and laptop desks.
- Send the public Ananas min:max price filter, retaining local price checks and fresh product-page verification.
- Parse the Russian request ноутбук до 100к as laptop with a 100,000 RSD ceiling.
- Add a bounded Computers.rs laptop adapter using public category pagination (first three pages), product-page price and breadcrumb, and the existing robots-aware rate-limited fetcher. It never submits the order form. It does not cover the entire shop catalogue.
- Show availability separately from a rechecked price, preserve unknown stock on reread, and rank confirmed availability first among equivalent relevance scores.

Validation: 261 tests, typecheck, production build, search scenario check and finance scenario check passed. The build still reports its existing large-bundle warning.

Repeat:

```sh
REALDEAL_LLM=0 node --import tsx scripts/live-scout.ts "ноутбук до 100к"
```

Full local evidence: `data/out/live-laptop-2026-11-27.json` (generated, not committed). Saved HTML excerpts under `data/pages/computers/` and `data/pages/tehnomedia/search-laptop-cards.html` are parser regressions, not sources for live search. The live script distinguishes confirmed and unknown stock; populated tiers passing its checks do not establish stock where a shop omits it.
