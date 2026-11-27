# Live budget search check

Checked: 2026-11-27 13:51:32 CET.

Request: `Phone for 100000 RSD`, through `createGoalFromPrompt` and the real scout registry, with no injected shops or fixture responses.

Result: 9 verified, in-stock mobile-phone offers, 3 in each budget band. Each selected product page was fetched again before acceptance. Prices below are the recorded values at this check.

| Tier | Range (RSD) | Verified example | Known total (RSD) | Delivery |
| --- | --- | --- | ---: | --- |
| budget | 1–33,333 | [Xiaomi Mobilni telefon Redmi A5, 4/128GB, Black](https://ananas.rs/proizvod/xiaomi-mobilni-telefon-redmi-a5-4-128gb-black/7353493) | 13,249 | unknown; not included |
| mid | 33,334–66,666 | [Xiaomi pametni telefon Redmi Note 17 Pro, 6,83", 50Mpx, 6GB/256GB, crni](https://ananas.rs/proizvod/xiaomi-pametni-telefon-redmi-note-17-pro-6-83-50mpx-6gb-256gb-crni/7435092) | 35,899 | unknown; not included |
| top | 66,667–100,000 | [SAMSUNG Galaxy S26 FE 5G 8GB/128GB Blueberry SM-S741BZVDEUC](https://www.tehnomedia.rs/proizvod/samsung-galaxy-s26-fe-5g-8gb-128gb-blueberry-sm-s741bzvdeuc) | 74,999 | 0 |

Sources: Ananas read 15 product pages; Tehnomedia read 20. eponuda and Cenoteka returned HTTP 403 and are reported as **blocked**, not successful empty searches. No attempt was made to bypass those responses.

Fixes from the live check:

- Enabled Tehnomedia as a second independent shop.
- Filtered search cards by price and relevance before spending product-page slots.
- Read the shop’s product category / breadcrumb to reject accessories with misleading names (such as a cable called I-PHONE).
- Rejected toys, headphone listings, bags, lanyards, coolers and landlines for a generic mobile-phone request. Explicit accessory / landline requests remain supported.
- Stopped treating Pro, Lite and FE as wrong variants for a generic category request.
- Reported comparison-site access failures explicitly and stamped completion after verification.

Repeat:

```sh
REALDEAL_LLM=0 node --import tsx scripts/live-scout.ts "Phone for 100000 RSD"
```

The script writes `data/out/live-scout.json` and exits nonzero if a capped search lacks any tier or includes an unverified/out-of-range result. The full local record of this run is `data/out/live-budget-2026-11-27.json` (generated output, not committed).

Validation: 252 tests, typecheck, production build, search scenario check and finance scenario check passed. Prices, stock and site access can change; unknown delivery remains visible as extra.
