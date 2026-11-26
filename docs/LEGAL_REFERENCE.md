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
