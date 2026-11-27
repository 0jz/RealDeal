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

# Shops that sell directly: gate check

Checked November 26, 2026, after eponuda and Cenoteka failed, with the same honest User-Agent (`RealDealBot/0.1`). Goal: shops whose own pages we can read for exact price, picture and listing link.

## Blocked for our fetcher (Cloudflare challenge or no answer)

tehnomanija.rs, emmi.rs, bcgroup-online.com and lcwaikiki.rs return a `cf-mitigated: challenge`. nsport.rs didn't respond. Off, for the same reason as eponuda.

## robots.txt disallows the search path

| Shop | Disallowed |
|---|---|
| winwin.rs | `/catalogsearch/`, `/search/` |
| djaksport.com, fashionandfriends.com, planetasport.rs | `/catalogsearch/` |
| buzzsneakers.rs, sportvision.rs | `/*?search=` |
| deichmann.com | `/search?q=` |
| shoppster.rs | `/search/*` |

Off. A Gigatron-style sitemap reader could work for some of them, but their terms were not read. Not part of this build.

## Readable, but the terms restrict use

- **Dr Techno (drtechno.rs).** Search `/search/<q>` is server-rendered and allowed by robots. robots.txt also carries `Content-Signal: search=yes, ai-train=no, use=reference`. The terms say all information on the site is informational only and may not be used commercially or passed on to third parties. **Off.**
- **Intersport / N Sport (intersport.rs).** Search works (`index.php?mod=catalog&op=thm_search&keywords=<q>`). Terms articles 29–30 claim exclusive copyright over the whole service, data and databases included, and treat any use without prior written permission as infringement. **Off.**

## Passed

| Shop | Sells | Search URL | Terms |
|---|---|---|---|
| **Tehnomedia** (tehnomedia.rs) | electronics, home appliances | `/search/find.html?rec=<q>` | Terms of use read: no clause on automated reading, copying or databases found. |
| **Ananas** (ananas.rs) | marketplace: everything, clothing included | `/search?query=<q>` (robots disallows `/api/`, `/app2/api/`, `/en/`, `/sr/`, so the HTML search page, not the API) | No explicit scraping ban. "Zabrana zloupotrebe Platforme" forbids interfering with security functions or with functions that prevent or limit copying; we bypass nothing. The body of the "Zaštita autorskog prava" section was not captured; read it before any public use. |
| **Office Shoes** (officeshoes.rs) | shoes, clothing | POST `/products/search` with `q=` redirects to a GET listing URL with `?q=`; use that GET form | robots.txt empty. Purchase terms only; no clause on automated reading or content use found. |
| **Gigatron** (gigatron.rs) | electronics | existing sitemap + JSON-LD adapter (search is robots-disallowed) | Personal, non-commercial use only (see above). |

"Passed" means no robots or terms clause forbids a polite reader, not a legal opinion. All four are fine for the research prototype and the pitch demo. Before RealDeal is offered publicly or commercially, ask each shop (Gigatron's terms already require that), and re-read Ananas's copyright section.

# Electronics shops from the Cenoteka and eponuda lists: gate check

Checked November 27, 2026, with the same honest User-Agent (`RealDealBot/0.1`): one robots.txt, one homepage and one search for "laptop" per shop, then the terms pages linked from the homepage. Domains come from Cenoteka's outgoing shop links. The shop lists are in `docs/SHOP_LISTS.md`.

## Blocked for our fetcher

- **Cloudflare challenge:** gamecentar.rs, imikom.com. Off, as with eponuda.
- **No answer:** pcpractic.rs (homepage 404). pccool.rs loads its homepage, but its search (`/search/<q>/0`) timed out twice.

## robots.txt disallows the search path

| Shop | Disallowed |
|---|---|
| jakov.rs | `/pretraga-proizvoda/` |
| eklik.rs | `/search` |
| eplaneta.rs | `/rezultati-pretrage/` |
| soping.rs | `/pretraga` (our robots check) |
| shoptogo.rs | `/catalogsearch/` |
| oblivion.rs | `?s=` search (our robots check) |

Off.

## Readable, but the terms restrict use

- **GStore (gstore.rs).** The terms claim copyright on all content, databases included, and call any unauthorised use of any part of the portal an infringement. **Off.**
- **Stamteh (stamteh.rs).** "Legal info": you agree not to reproduce, distribute or exploit the site's content for any commercial purpose. **Off.**
- **ComputerLand (computerland.rs).** The terms forbid "using specialised programs to download content from the site or app". **Off.**
- **Tempo Tehnika (tempo-tehnika.rs).** "Visual content may not be used without prior consent." Results need the picture. **Off.**

## Passed

| Shop | Search URL | Prices in the HTML | Terms |
|---|---|---|---|
| **Laptop Centar** (laptopcentar.rs) | `/search/<q>/0` (a broad word like "laptop" redirects to the category) | yes, `57.989,00 din` | Opšti uslovi poslovanja read: the only copying ban is about the user account, not the site content. |
| **SMB Tehno** (smbtehno.rs) | `/products/?search=<q>` | yes, `product-card-price` "225950.00 RSD" | Terms of use read: no clause on automated reading or content use. |
| **Next Computers** (nextcomputers.rs) | `/proizvodi/pretraga?q=<q>` | yes | Uslovi korišćenja read: no such clause. robots.txt blocks AI crawlers (ClaudeBot, CCBot, Bytespider and others) by name, but not other bots. |
| **Frog** (frog.rs) | `/pretraga/<q>` | yes, `393.920 RSD` | Uslovi korišćenja read: no such clause. |
| **Overnight** (overnight.rs) | `/pretraga-proizvoda?q=<q>` | in the page's Inertia JSON (`data-page` → `props.products`), not in the HTML | Only purchase and delivery terms found; no general terms of use. |
| **DS Market** (dsmarket.rs) | `/results,1-40?search=true&keyword=<q>` | yes, `2.111,11 RSD` | No terms page found from the homepage. Find and read it before building the adapter. |

Same caveat as above: "passed" is not a legal opinion. None of these adapters is built yet.
