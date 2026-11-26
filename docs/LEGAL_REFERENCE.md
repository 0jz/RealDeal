# Reference-price screening: scope and source

Reviewed November 26, 2026 against the Serbian National Assembly's [adopted Law amending the Trade Law, article 14 (amending article 37)](https://www.parlament.gov.rs/upload/archive/files/lat/pdf/zakoni/14_saziv/1266-26-lat..pdf), page 3, and the [Official Gazette 35/2026](https://slgl.pravno-informacioni-sistem.rs/api/prins/viewdoc?uuid=5e1627a4-81c0-452d-9f5c-d8c3ab84ddd1).

The amendment uses the lowest offered price during the 30 days before a reduction. It excludes perishable goods and goods with a short shelf life. For products in the trader's assortment for less than 30 days, the reference requires a period of at least 15 days. For uninterrupted progressive reductions, the reference remains the 30-day period before the reduction campaign began.

Implementation consequences:

- Missing observations do not prove a product was newly introduced. Ordinary checks require a complete 30-day history.
- A shorter assortment period must be explicit; fewer than 15 observed days are inconclusive. The implementation conservatively uses all explicitly known assortment days up to 29.
- Perishables return `exception`. Progressive campaigns can supply their pre-campaign reference history.
- `legal` remains a compatibility field for the existing search UI, but means reference consistency, not a finding of legal compliance. New code also exposes a descriptive status.
- Real-world applicability depends on evidence and the offer's circumstances. The demo data is synthetic; this is not a legal determination about a shop.

The previous source comment incorrectly attributed the provision to consumer-protection law and inferred new-product status from null entries. Both were corrected. No broad claim about enforcement dates is needed for this prototype.

# Live scouting on eponuda and Cenoteka: gate check

Checked November 26, 2026 (step 0 of `docs/SCOUTS_PROMPT.md`), with the same honest User-Agent `politeFetch` sends (`RealDealBot/0.1`).

## Cenoteka (cenoteka.rs): not allowed

- **robots.txt** allows everything except `/_next/data/*.json`, `/redirect/` and `/offline/`.
- **Technically readable.** Search (`/pretraga/?q=...`) and product pages (`/p/<slug>/`) are server-rendered with our User-Agent, no challenge. Product pages carry JSON-LD `Product` (name, images, GTIN) and one `/redirect/?...&shop_id=..&product_price=..` link per shop. It also lists phones, TVs and laptops now, not only groceries.
- **Terms of use forbid it** ([uslovi korišćenja](https://cenoteka.rs/uslovi-koriscenja/)). In summary:
  - Normal use means using the portal *without software tools (spiders, scripts, etc.)*, at most two requests per second. Any other use is forbidden, and the terms say it will be reported to the authorities.
  - No data from the portal may be used for commercial purposes without Cenoteka's permission.
  - Collecting the data into any public or private database is not allowed, and neither is republishing it unless marked as allowed.
  - The database is protected under the Serbian copyright and related rights law. Only insignificant parts may be used.
- **Decision:** the Cenoteka scout stays off. A scripted reader breaks the terms however politely it fetches. It could only be turned on with written permission from Cenoteka d.o.o. (for example, a data or partner agreement).

## eponuda: moved to eponuda.com, blocked for automated clients

- **The site moved.** `www.eponuda.rs` returns HTTP 522 (Cloudflare can't reach the old server). `eponuda.rs` redirects to **`www.eponuda.com`**, which works in a normal browser. It has a clothing and shoes section ("Odeća i Obuća") as well as electronics.
- **robots.txt** (`www.eponuda.com/robots.txt`, read in a browser) allows `/` for all agents. It disallows `/link?` and `/link/` (the outgoing shop links), `/ajax/`, `/axios/`, `/compare-product`, `/uporedicene`, `/r?`, and URLs with `brand`, `sortBy=`, `attr_*`, `minPrice=` or `maxPrice=` parameters. So price-range filtering has to happen on our side, not through eponuda's URL filters.
- **Our fetcher gets a challenge, not the page.** Every request with `politeFetch`'s User-Agent, robots.txt included, returns `403` with `cf-mitigated: challenge`. Only a browser that runs Cloudflare's JavaScript challenge gets through. Getting a script past that check is bot-detection bypass, which the hard rules forbid. A plain-HTTP scout cannot read eponuda.com.
- **Terms of use** (`/uslovi`) are served as a file download, not a page, and were not read.
- **Decision:** the eponuda scout stays off. Ways to turn it on legitimately: eponuda allowlists our bot (for example as a Cloudflare verified bot), or gives us a partner feed or API. "Registracija prodavnice" on the site suggests they have a shop/partner programme to ask through. Read the `/uslovi` file before any of that.

## Result

Neither site passed the gate, so the build stopped at step 0, as the prompt says. No pages were saved to `data/pages/`.
