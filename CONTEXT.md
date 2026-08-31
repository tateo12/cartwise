# Cartwise

A grocery price comparison tool for the Salt Lake Valley. It answers one question — **of the stores I actually shop, where do I spend the least on the things I actually buy?** — and it never hides a cheaper option behind a barcode mismatch. (`Cartwise` is a working name, not final.)

## Language

### The priced things

**Chain**:
A retail company whose prices are sourced as a unit (Kroger, Walmart, Costco, WinCo, Harmons). The thing an adapter is written against.
_Avoid_: retailer, brand (brand means product brand here), grocer.

**Banner**:
A consumer-facing storefront name operating under a Chain. **Smith's is a Banner of the Kroger Chain** — this matters because one Kroger credential prices Smith's, Fred Meyer, King Soopers and Ralphs alike. Users recognise Banners; adapters target Chains.
_Avoid_: sub-brand, division.

**Store**:
One physical location of a Banner, at an address. **Prices belong to a Store, not a Banner** — two Smith's across the valley can legitimately differ. The unit of comparison.
_Avoid_: location (OK in conversation), branch, shop.

**Product**:
One store-sellable SKU as the Chain describes it — "Kroger Whole Milk, 1 gal", UPC 0001111041700, at Smith's. Chain-specific by definition; the same milk at WinCo is a *different* Product.
_Avoid_: SKU (implementation alias), listing, article.

**Offer**:
The price of one Product at one Store at one point in time. The atomic fact every provider returns, and the only thing that is ever literally true. Carries its own Provenance.
_Avoid_: price (too vague — a price without a Store and a timestamp is meaningless), quote.

**Item**:
The cross-store equivalence class the *user* shops for — "whole milk, 1 gal". Many Products from many Chains map into one Item. **Item is the unit of comparison; Product is the unit of reality.** A basket is a list of Items, never of Products.
_Avoid_: product (reserved above), good, SKU, thing.

### Trusting the match

**Match**:
The link asserting that a Product belongs to an Item. Never assumed correct — always carries a Match confidence.

**Match confidence**:
How much the app trusts a Match. **High** = shared UPC/GTIN, provably identical. **Medium** = inferred from normalized brand, size and category — this is where store brands live, and therefore where most real savings live. **Unmatched** = surfaced to the user as a candidate, never silently folded in. Confidence is always visible in the UI; a Medium match is a claim, not a fact.
_Avoid_: match score (implies a tuned number the user must interpret), accuracy.

**Pinned match**:
A Match the user has explicitly confirmed or corrected. **Permanent ground truth** — it overrides the matcher forever and is never re-derived. The mechanism by which the app gets more correct the longer it is used.
_Avoid_: manual match, override (OK in conversation), locked match.

**Pack multiple**:
How many retail units one Product contains — Costco's Kirkland milk is 2 × 1 gal. Kept separate from size so that a per-unit comparison stays honest *and* the app can still say "cheapest, but you must buy two."
_Avoid_: quantity (ambiguous with basket quantity), pack size, count.

**Provenance**:
Where an Offer's number came from. **Live** = fetched from an official Chain API. **Seed** = a realistic placeholder for a Chain with no public price source. **User** = observed by the user, typically off a receipt. First-class and always badged — a Seed number must never be mistakable for a Live one.
_Avoid_: source (overloaded), origin, data quality.

### Shopping the answer

**Basket**:
The list of Items the user intends to buy, with a quantity each. Always Items, never Products — the user wants milk, and the app decides whose milk.
_Avoid_: cart (implies a store-side checkout), list (reserved for Staples list), order.

**Stop**:
One visit to one Store on a single shopping trip. The unit of inconvenience, and the thing savings are traded against.
_Avoid_: trip (a trip is the whole outing, and has many Stops), visit.

**Plan**:
A concrete way to buy the whole Basket: which Items at which Stores, over how many Stops, for what total. A one-Stop Plan is still a Plan.
_Avoid_: route (routing/drive order is not modelled), strategy, solution.

**Store winner**:
The single Store with the lowest total for the whole Basket. **The headline answer** — because it is the trip most people actually take. Notably, a Store winner need not be cheapest on any individual Item.
_Avoid_: best store (too vague), cheapest store (ambiguous — cheapest at what?).

**Savings ladder**:
The ranked list of multi-Stop Plans shown beneath the Store winner, each labelled with what it saves and what it costs in Stops. The upsell, never the headline.
_Avoid_: optimizer output, recommendations.

### Judging a price

**Unit price**:
Price per base unit — **oz** for mass, **fl oz** for volume, **ct** for count — with Pack multiple applied. The only honest way to compare a $8 bulk pack against a $3 box. Cross-dimension comparison is deliberately impossible: there is no true answer to "is 16 oz of cheese cheaper than 12 fl oz of milk".
_Avoid_: price per unit (ambiguous — which unit?), normalized price.

**Deal verdict**:
What the current price is worth relative to its *own* 90-day history at that Store: **Real low**, **Good price**, **Typical price**, **Running high**, or **Fake sale**. A retailer's sale tag is an input, never the verdict.
_Avoid_: deal score, discount (a discount is off the retailer's own reference price, which is not evidence).

**Fake sale**:
A price advertised as a promotion while sitting at or above that Product's recent median at that Store. Detecting these is a feature, not an edge case.
_Avoid_: false sale, fake discount.

**Staple**:
An Item the user has bought on three or more logged trips. Staples are assumed to run out on a roughly weekly cadence, which is what drives restock suggestions.
_Avoid_: regular, favourite, subscription.

## Example dialogue

> **Dev:** The search bar says WinCo is cheapest for milk at $2.98, but the dashboard is telling me to shop at Smith's. Is that a bug?
>
> **Domain:** No — different questions. The search bar gives you the per-**Item** best. The dashboard gives you the **Store winner**, which is the cheapest *whole* **Basket** in one **Stop**. Smith's can lose on milk and still win the trip.
>
> **Dev:** WinCo doesn't stock the olive oil. Do I just leave it out of WinCo's total?
>
> **Domain:** Absolutely not — then WinCo wins by selling you less. Source it from the cheapest selected **Store** that has it, add that as a **forced** **Stop**, and total the complete **Basket**.
>
> **Dev:** Costco's milk is a 2-gallon pack. Cheapest per gallon, most expensive to buy.
>
> **Domain:** Both facts are real. **Pack multiple** is 2, so the **Unit price** shows it winning per gallon while the **Offer** total shows what you actually hand over. Never collapse those into one number.
>
> **Dev:** And the ketchup is Heinz at every store, so those match exactly?
>
> **Domain:** Right — shared UPC, so **Match confidence** is High. The milk is store brands, so it can only ever be Medium. If I tell you a Medium match is wrong, that becomes a **Pinned match** and you never re-derive it.

## Flagged ambiguities

None outstanding. Resolved decisions live in `docs/adr/`.
