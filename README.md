# RealDeal

> **No fake discounts. Just do it.** · Team **JDI** · JigJoy Black Friday AI Hackathon 2026

A live, buyer-side swarm of concurrent agents (built on [Mozaik](https://github.com/jigjoy-ai/mozaik)) that checks Black Friday "discounts" against Serbia's **30-day rule**, KP market prices, and other shops, and keeps a live verdict for every product on your watchlist:

**REAL DEAL · FAKE DISCOUNT · BUY ON KP INSTEAD · WAIT**

## The 30-day rule

Since 1 May 2026, Serbian consumer protection law requires the advertised "previous price" to be the **lowest price the shop offered in the 30 days before the sale** (at least 15 days for products in stock less than 30 days).

## Run

```bash
npm i
npm run dev        # PriceFeed + ThirtyDayAgent + KPMarketAgent, prints the event timeline
npm run data       # writes data/out/dataset.json, checks every planted pattern
npm run typecheck
```

## How agents run concurrently (so far)

Every agent is a Mozaik participant on one shared runtime. `publish()` hands each event to every participant's matching handler **without awaiting it**, so each agent's async handler runs on its own: when `price.changed` arrives, ThirtyDayAgent and KPMarketAgent both start on it at the same moment, and KP lookups from earlier events are still in flight while new prices arrive. There is no central scheduler. Agents publish their findings (`discount.fake`, `kp.price`, …) as new events that other agents can react to. Every emit/start/end is logged with a timestamp and agent name ([src/runtime.ts](src/runtime.ts), [src/agents/kit.ts](src/agents/kit.ts)).

## Status

🚧 Work in progress. See [docs/PROJECT_BRIEF.md](docs/PROJECT_BRIEF.md) for the full brief.

Coming in this README: architecture diagram, agent table, **how agents run concurrently**, run instructions, demo video, live link.

## Data

All data in this project is **synthetic**. Shop names and prices are fictional and do not describe the behaviour of any real retailer.
