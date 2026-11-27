# Budget search

A capped search returns three price groups, using integer RSD and the known
total (item price plus delivery). For a 100,000 RSD limit:

| Tier | Inclusive range |
| --- | --- |
| Budget | 1–33,333 |
| Mid-range | 33,334–66,666 |
| Top | 66,667–100,000 |

The boundaries come from `src/search/budget.ts`. Top denotes the upper price
range, not a guarantee of product quality. Unknown delivery remains unknown
and is labelled as extra in the UI; it is never presented as free shipping.
Empty groups stay visible. The engine never fills them with out-of-range items.

The prompt planner passes the spendable budget (cash minus reserve) to each
wish's search, capped further by an explicit item maximum. Multiple wishes
share this ceiling; it is not an allocation of the full amount to every wish.
The existing finance optimizer still checks the combined cost. Changing cash
or reserve restarts scouting and discards the previous generation's results.

Scouts that support price ranges search each band. eponuda and Cenoteka filter
their category-card prices before limiting product-page URLs. Queries and bands
share the page allowance in round-robin order. The final price is always read
from the product page. Search coverage is limited to the pages available from
each adapter; a missing band does not prove no such products exist elsewhere.

The ranker filters unavailable listings and totals above the cap. Verification
keeps up to three listings per band, replacing failed candidates within that
band. Changed prices, delivery costs or stock invalidate verification. The
legacy budget search and Telegram bot expose one best eligible pick per band.

Validation: `npm test`, `npm run typecheck`, `npm run check`,
`npm run check:finance`, `npm run build`. Tests use deterministic listings and
saved shop HTML, including exact boundaries, delivery, empty bands, failures,
generic categories, budget edits and cache isolation. They make no claim that
live shops are currently reachable.
