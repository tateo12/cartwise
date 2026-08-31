# Basket totals are always complete, and the selected store set is a hard filter

Two rules govern every total in the app.

**The selected Store set is a hard filter.** An Offer at a Store the user has not selected does not exist — it is excluded from totals, from the search bar, and from the savings ladder. The user asked for "the best price in the list of stores I select"; quietly folding in a cheaper unselected store would produce a total they cannot actually pay.

**Totals are always for the complete basket.** If a Store does not carry an Item, it does not get a smaller bill. The Item is sourced from the cheapest *selected* Store that has it, and the resulting extra Stop is marked `forced` and surfaced in the UI. Dropping unavailable Items instead — the obvious implementation — silently compares a 7-item total against an 8-item total, which lets the Store with the **worst selection win by having the least to charge for**. That bug is invisible: every individual number on screen is correct and only the comparison between them is meaningless.

When no selected Store carries an Item at all, it is reported in `unavailableItemIds` and the Plan is flagged as incompletable. It is never silently omitted.

## Consequences

- Optimization is brute force over store subsets (C(8,3) = 56 at most). Correct and instant at this scale; a heuristic would risk returning a wrong "best" for no benefit.
- Pack-based totals still misrepresent warehouse clubs, whose packs deliver more product. The dashboard therefore compares against the **runner-up** store rather than the priciest, and flags stores selling materially larger packs. The unit-price column is the honest cross-pack comparison.
- A Store can be the Store winner while being cheapest on none of the individual Items. This is correct and expected — see ADR 0002.

## Amendment: gap consolidation and stops-before-price

The two rules above were necessary but not sufficient. An adversarial review found
two ways the optimizer still produced confidently-wrong recommendations, both
traced to the same mistake: **sourcing each gap Item at the global per-Item
minimum.**

1. **A narrow-range Store could win the headline by cherry-picking.** With a
   six-Item basket, Costco carried one Item yet headlined at $15.94 against a
   complete one-stop Smith's at $16.24 — because the other five Items were priced
   at whichever store was cheapest for each, silently assuming three stops. A
   store that stocks almost nothing inherited best-in-set pricing on everything
   it doesn't stock.

2. **A degenerate anchor could win with zero contribution.** An anchored Plan for
   a store carrying none of the basket had no assignments from its own anchor,
   tied another store's Plan, won on selection order, and rendered
   "WinCo doesn't carry chicken — picked up at WinCo".

So a third rule: **gaps are consolidated onto as few additional Stores as
possible** (repeatedly take the store covering the most remaining Items,
cheapest on ties), an anchor contributing zero assignments is not a headline
candidate, and Plans rank by *completeness, then Stop count, then price* — Stop
count **before** price, because ADR 0002 makes the headline the cheapest single
Store. `Plan.anchorId` is now explicit so the UI never infers it.

A separate bug in the savings ladder had the same shape: ladder subsets were
planned without an anchor, so an Item no store in the subset carried was dropped
from `unavailableItemIds` straight out of the total. One row read
"WinCo + Trader Joe's — save $4.39", and $4.39 was exactly the price of the
Fairlife milk it omitted. Ladder rows now must be at least as complete as the
winner.

## Consequences

- A cheaper multi-stop plan is never suppressed — it moves from the headline into
  the ladder, where its extra stop is stated. Nothing is hidden, only re-labelled.
- The regression tests for these are property-based where possible: a sweep over
  many basket/store combinations asserts no ladder row is ever less complete than
  the winner. The original test asserted only that ladder totals were *lower*,
  which is exactly why it passed while the bug was live.
