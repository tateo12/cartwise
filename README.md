# Cartwise

A grocery price comparison app for the Salt Lake Valley. It answers one question:
**of the stores I actually shop, where do I spend the least on the things I actually buy?**

```bash
bun install
bun run dev       # http://localhost:3000 — seeds itself on first request
```

No setup step. The database is created and seeded on first page load.

## What it does

| Surface | Question it answers |
| --- | --- |
| Search bar | Cheapest store for **this one item** |
| Dashboard | Cheapest **single store** for the whole basket, plus forced detours |
| Savings ladder | Whether a 2nd or 3rd stop is worth the money it saves |
| Item detail | 90-day price history, real-low vs. fake-sale, all matched products |
| All prices | Every item's cheapest store and cross-store spread |
| Watchlist | Alerts when a watched item hits a genuine low |
| Pantry | What you buy, how often, and what's due for a restock |
| Receipts | What you actually paid — the only prices that are neither fetched nor seeded |

## The honest part: where prices come from

**Kroger is the only chain here with a real, official, free price API.** One credential
prices Smith's, King Soopers, Fred Meyer, Ralphs, QFC, Fry's, Dillons and Harris Teeter.

Harmons, WinCo, Walmart, Costco, Target, Sprouts and Trader Joe's publish nothing
comparable. Their prices here are **deterministic seeded placeholders** — realistic, stable
across restarts, and badged `Seed` everywhere they appear. Getting real numbers from them
means scraping internal endpoints, which violates their terms, sits behind commercial bot
defence, and breaks constantly.

Every price in the app therefore carries its provenance, always visible:

| Badge | Meaning |
| --- | --- |
| `Live` | Fetched from the retailer's official API |
| `Seed` | Realistic placeholder — this chain has no public price API |
| `You` | Recorded by you from a receipt |

A deal verdict is only as good as the history behind it, so a **live** price is
judged against live history only. Until 14 live points accumulate it reports
**No history yet** rather than quoting a low drawn from seeded data.

### Turning on real Kroger prices

Get free credentials at [developer.kroger.com](https://developer.kroger.com), then:

```bash
cp .env.example .env.local
# fill in KROGER_CLIENT_ID and KROGER_CLIENT_SECRET
```

Then open **My stores → Refresh live prices**. Credentials alone change nothing: the
refresh is what actually calls Kroger and overwrites the seeded offers, and the sidebar
distinguishes "connected" from "N live prices loaded". Anything Kroger can't price keeps
its seeded value and stays badged `Seed`.

Adding another chain means writing one `PriceProvider` implementation — the optimizer and
UI need no changes.

## Design decisions worth knowing before you change anything

These are the non-obvious ones. Full reasoning in [`docs/adr/`](./docs/adr/);
domain vocabulary in [`CONTEXT.md`](./CONTEXT.md).

1. **An `Item` is a cross-store equivalence class, not a barcode.** Store brands share no
   UPC, and store brands are where the savings are. Matching runs a confidence ladder
   (UPC → brand/size/category → unmatched) and every match shows its confidence. Your
   corrections become permanent `Pinned matches`. ([ADR 0001](./docs/adr/0001-item-is-a-tiered-equivalence-class.md))

2. **The dashboard headline is not the lowest possible number.** Cherry-picking every item
   at its cheapest store is a spreadsheet, not a trip. The headline is the best *single*
   store; cheaper multi-stop plans sit one glance below in the ladder.
   ([ADR 0002](./docs/adr/0002-three-surfaces-answer-three-questions.md))

3. **Totals are always for the complete basket, gaps consolidate onto one extra store, and
   stop count ranks before price.** A store that doesn't carry something does *not* get a
   smaller bill. But sourcing each missing item at whichever store is individually cheapest
   let a store carrying 1 of 6 items "win" by assuming three stops — so leftovers are
   consolidated onto as few extra stores as possible, and a complete one-stop plan always
   outranks a cheaper multi-stop one, which lives in the ladder instead.
   ([ADR 0004](./docs/adr/0004-complete-basket-totals-and-hard-store-filter.md))

4. **Your selected stores are a hard filter.** An unselected store's prices never enter any
   total, even when cheaper.

5. **Warehouse clubs need the unit-price column.** Costco's higher basket total reflects
   bigger packs, not worse prices. The dashboard compares against the *runner-up* store
   rather than the priciest, and flags stores selling materially larger packs.

## Layout

```
src/
  core/        pure domain logic — no I/O, fully unit-tested
    domain.ts    types; Offer / Product / Item / Plan
    units.ts     size parsing and unit-price normalization
    pricing.ts   deterministic seeded prices (no Math.random, ever)
    optimizer.ts store winner, savings ladder, forced stops
    history.ts   real-low vs. fake-sale detection
    pantry.ts    restock prioritisation
  data/        the Item catalog and SLC store set (code, not database)
  providers/   PriceProvider seam + the real Kroger adapter
  db/          node:sqlite schema, seeding, and queries
  server/      view models (server-only)
  app/         Next.js App Router pages and server actions
  components/  UI primitives and client interactivity
```

`core/` has no I/O and no framework imports, which is why it can be tested directly:

```bash
bun test          # 51 tests, pure core
bun run typecheck
bun run lint      # oxlint
```

Several tests are explicit regressions for bugs found by adversarial review, and are
labelled with the wrong output they used to produce. The ladder-completeness one is a
property sweep over many basket/store combinations, because the original test asserted only
that ladder totals were *lower* — which is how it passed while the ladder was "saving"
money by silently dropping items.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind v4 · Recharts ·
`node:sqlite` (Node 24 built-in — no native module to compile)

Bun installs packages and runs the tests. Node runs the app. Seeding lives *inside* the
app rather than in a standalone script, so only one runtime ever touches SQLite.

## Install it on your phone

Cartwise is a PWA, so it installs to your home screen with its own icon and no
browser chrome.

**On the same WiFi, no hosting needed.** `bun run dev` prints a Network URL
(something like `http://10.0.0.131:3000`). Open that on your phone, then:

- **iOS Safari:** Share → Add to Home Screen
- **Android Chrome:** menu → Install app

Phones get a bottom tab bar instead of the sidebar. Verified at iPhone viewport
with zero horizontal overflow on every route.

## Cart push: getting your list into a real cart

The **Order** step of a trip links to each store. For Kroger-family stores it can
do better and actually fill your cart.

1. Get free credentials at [developer.kroger.com](https://developer.kroger.com)
   and register `http://localhost:3000/api/kroger/callback` as a redirect URI.
2. Put `KROGER_CLIENT_ID` and `KROGER_CLIENT_SECRET` in `.env.local`.
3. On the trip's Order screen, hit **Connect Kroger cart** and sign in with your
   Kroger account. That grants `cart.basic:write`.
4. **Send list to cart** now pushes your items into your Smith's pickup cart via
   `PUT /v1/cart/add`.

One real constraint: cart push needs Kroger's own UPC per item, which arrives
only from a live price refresh. Items without one are reported as skipped rather
than silently dropped. Hit **Refresh live prices** on My stores first.

No other chain has a usable cart API. Walmart, Target and Costco are link-only.

## Deploying

The code lives on GitHub; the app needs a host that runs Node.

**GitHub Pages will not work.** It serves static files, and this app has server
components, server actions and a SQLite database.

**Fly.io** is the fit, because SQLite needs a real disk:

```bash
brew install flyctl
fly auth login
fly launch --no-deploy          # reads the committed fly.toml
fly volumes create cartwise_data --size 1 --region den
fly secrets set KROGER_CLIENT_ID=... KROGER_CLIENT_SECRET=...
fly secrets set KROGER_REDIRECT_URI=https://<your-app>.fly.dev/api/kroger/callback
fly deploy
```

Then add that same callback URL to your Kroger developer app.

**Do not deploy this to Vercel as-is.** Its filesystem is ephemeral, so your
basket, receipts and pinned matches would vanish on every deploy. Vercel would
require swapping `node:sqlite` for a hosted database such as Turso or Neon.

### Before you put it on the internet

**There is no login.** Anyone with the URL can see your basket, receipts and
pantry, and can push to your Kroger cart if you have connected it. For a personal
app on an unguessable Fly URL that may be fine; if not, add auth first.
