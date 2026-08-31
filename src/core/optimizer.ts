import type { Assignment, BasketLine, Offer, Plan, Product, Store } from './domain';

/**
 * Basket optimization.
 *
 * Three rules carry the whole design (ADR 0004 and ADR 0002):
 *
 *  1. **The selected Store set is a hard filter.** An Offer at an unselected
 *     Store does not exist.
 *
 *  2. **Totals are always for the COMPLETE basket.** A Store that cannot supply
 *     an Item does not get a smaller bill — the Item is sourced elsewhere and
 *     that Stop is marked `forced`. Dropping unavailable Items would let the
 *     Store with the worst selection win by having the least to charge for.
 *
 *  3. **Gaps are consolidated onto as few extra Stores as possible**, and the
 *     headline ranks by Stop count BEFORE price.
 *
 * Rule 3 exists because of two bugs that rule 2 alone did not prevent. Sourcing
 * each gap Item at the global per-Item minimum handed a narrow-range Store
 * cherry-pick pricing on everything it doesn't stock: Costco carrying 1 of 6
 * basket Items "won" at $15.94 over a complete one-stop Smith's at $16.24, by
 * assuming three stops. A real second stop is ONE store, not a different store
 * per item — and a 3-stop trip must never outrank a 1-stop trip on price alone.
 */

export interface OfferIndex {
  /** All Products keyed by itemId. */
  productsByItem: Map<string, Product[]>;
  /** Offer keyed by `${productId}|${storeId}`. */
  offers: Map<string, Offer>;
  storesById: Map<string, Store>;
}

export function offerKey(productId: string, storeId: string): string {
  return `${productId}|${storeId}`;
}

/** An Item is buyable at a Store only if stocked there and not known-out. */
function candidateOffers(index: OfferIndex, itemId: string, storeId: string): { product: Product; offer: Offer }[] {
  const products = index.productsByItem.get(itemId) ?? [];
  const store = index.storesById.get(storeId);
  if (!store) return [];
  const out: { product: Product; offer: Offer }[] = [];
  for (const product of products) {
    if (product.chainId !== store.chainId) continue;
    const offer = index.offers.get(offerKey(product.id, storeId));
    if (!offer) continue;
    if (offer.stock === 'out_of_stock' || offer.stock === 'not_carried') continue;
    out.push({ product, offer });
  }
  return out;
}

/**
 * Cheapest way to buy one Item at one Store. When a Store lists several
 * Products for an Item, the cheapest PACK wins — not the cheapest unit price,
 * because the user is buying one pack, not an ounce.
 */
export function bestAtStore(index: OfferIndex, itemId: string, storeId: string): { product: Product; offer: Offer } | null {
  const candidates = candidateOffers(index, itemId, storeId);
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b.offer.priceCents < a.offer.priceCents ? b : a));
}

/** Cheapest Store for one Item across a Store set. Used by the search bar. */
export function bestAcrossStores(
  index: OfferIndex,
  itemId: string,
  storeIds: string[],
): { storeId: string; product: Product; offer: Offer } | null {
  let best: { storeId: string; product: Product; offer: Offer } | null = null;
  for (const storeId of storeIds) {
    const found = bestAtStore(index, itemId, storeId);
    if (!found) continue;
    if (!best || found.offer.priceCents < best.offer.priceCents) {
      best = { storeId, product: found.product, offer: found.offer };
    }
  }
  return best;
}

function makeAssignment(
  line: BasketLine,
  storeId: string,
  found: { product: Product; offer: Offer },
  forced: boolean,
): Assignment {
  return {
    itemId: line.itemId,
    storeId,
    product: found.product,
    offer: found.offer,
    quantity: line.quantity,
    lineTotalCents: found.offer.priceCents * line.quantity,
    forced,
  };
}

function finishPlan(
  index: OfferIndex,
  anchorId: string | null,
  assignments: Assignment[],
  unavailableItemIds: string[],
): Plan {
  const usedStoreIds = [...new Set(assignments.map((a) => a.storeId))].sort((a, b) => {
    const da = index.storesById.get(a)?.driveMinutes ?? 0;
    const db = index.storesById.get(b)?.driveMinutes ?? 0;
    return da - db;
  });

  return {
    anchorId,
    storeIds: usedStoreIds,
    assignments,
    totalCents: assignments.reduce((sum, a) => sum + a.lineTotalCents, 0),
    forcedStopIds: anchorId ? usedStoreIds.filter((id) => id !== anchorId) : [],
    unavailableItemIds,
    driveMinutes: usedStoreIds.reduce((sum, id) => sum + (index.storesById.get(id)?.driveMinutes ?? 0), 0),
  };
}

/**
 * Builds an unanchored Plan over a Store set: every Item goes to the cheapest
 * Store in the set that carries it. This is the cherry-pick plan, used for the
 * savings ladder where the user has explicitly chosen to visit all of them.
 */
export function planForStoreSet(index: OfferIndex, basket: BasketLine[], storeIds: string[]): Plan {
  const assignments: Assignment[] = [];
  const unavailableItemIds: string[] = [];

  for (const line of basket) {
    if (line.quantity <= 0) continue;
    const chosen = bestAcrossStores(index, line.itemId, storeIds);
    if (!chosen) {
      unavailableItemIds.push(line.itemId);
      continue;
    }
    assignments.push(makeAssignment(line, chosen.storeId, chosen, false));
  }

  return finishPlan(index, null, assignments, unavailableItemIds);
}

/**
 * Builds a Plan for "I intend to shop at this Store".
 *
 * The anchor supplies everything it carries. Whatever is left over is
 * **consolidated**: we repeatedly pick the single additional Store that covers
 * the most remaining Items (cheapest on ties) until nothing is left. That
 * models a real trip — you make one more stop, not one stop per missing item —
 * and it stops a narrow-range anchor from inheriting the global minimum on
 * everything it doesn't stock.
 */
export function anchoredPlan(
  index: OfferIndex,
  basket: BasketLine[],
  selectedStoreIds: string[],
  anchorId: string,
): Plan {
  const assignments: Assignment[] = [];
  let remaining: BasketLine[] = [];

  for (const line of basket) {
    if (line.quantity <= 0) continue;
    const atAnchor = bestAtStore(index, line.itemId, anchorId);
    if (atAnchor) assignments.push(makeAssignment(line, anchorId, atAnchor, false));
    else remaining.push(line);
  }

  const unavailableItemIds: string[] = [];

  if (remaining.length > 0) {
    const extraCandidates = selectedStoreIds.filter((storeId) => storeId !== anchorId);
    const resolution = resolveGaps(index, remaining, extraCandidates);
    for (const { line, storeId, found } of resolution.assigned) {
      assignments.push(makeAssignment(line, storeId, found, true));
    }
    // Items no selected Store can supply — reported, never omitted silently.
    unavailableItemIds.push(...resolution.unresolved.map((line) => line.itemId));
  }

  return finishPlan(index, anchorId, assignments, unavailableItemIds);
}

interface GapAssignment {
  line: BasketLine;
  storeId: string;
  found: { product: Product; offer: Offer };
}

interface GapResolution {
  assigned: GapAssignment[];
  unresolved: BasketLine[];
}

/** Cheapest total for `lines` across a set of Stores, or null if any is missing. */
function coverAll(index: OfferIndex, lines: BasketLine[], storeIds: string[]): { assigned: GapAssignment[]; cost: number } | null {
  const assigned: GapAssignment[] = [];
  let cost = 0;
  for (const line of lines) {
    const chosen = bestAcrossStores(index, line.itemId, storeIds);
    if (!chosen) return null;
    assigned.push({ line, storeId: chosen.storeId, found: { product: chosen.product, offer: chosen.offer } });
    cost += chosen.offer.priceCents * line.quantity;
  }
  return { assigned, cost };
}

/** How many extra Stops we will search exhaustively before falling back. */
const MAX_EXACT_EXTRA_STOPS = 3;

/**
 * Assigns the Items an anchor cannot supply to as FEW extra Stores as possible.
 *
 * This is a set-cover problem, and the obvious greedy heuristic
 * (take the store covering the most items, repeat) is not minimal: with an
 * anchor missing i1..i6 where C covers {i1,i2,i4,i5}, A covers {i1,i2,i3} and B
 * covers {i4,i5,i6}, greedy takes C then A then B — three stops, where A+B does
 * it in two.
 *
 * With at most 7 extra stores an exhaustive search over subsets of size 1..3 is
 * only 63 combinations, so we solve it exactly and keep the greedy pass purely
 * as a fallback for the rare case where no small subset covers everything.
 */
function resolveGaps(index: OfferIndex, gaps: BasketLine[], extraStoreIds: string[]): GapResolution {
  const cap = Math.min(MAX_EXACT_EXTRA_STOPS, extraStoreIds.length);

  for (let size = 1; size <= cap; size++) {
    let best: { assigned: GapAssignment[]; cost: number } | null = null;
    for (const subset of combinations(extraStoreIds, size)) {
      const covered = coverAll(index, gaps, subset);
      if (!covered) continue;
      // Every subset at this size costs the same number of stops, so cost decides.
      if (best == null || covered.cost < best.cost) best = covered;
    }
    // First size that can cover everything is the minimum stop count.
    if (best) return { assigned: best.assigned, unresolved: [] };
  }

  // Nothing up to `cap` stores covers the whole gap set. Take as much as we can,
  // most-coverage-first, and report whatever genuinely nobody carries.
  const assigned: GapAssignment[] = [];
  const used = new Set<string>();
  let remaining = gaps;

  while (remaining.length > 0) {
    let best: { storeId: string; covered: GapAssignment[]; cost: number } | null = null;
    for (const storeId of extraStoreIds) {
      if (used.has(storeId)) continue;
      const covered: GapAssignment[] = [];
      let cost = 0;
      for (const line of remaining) {
        const found = bestAtStore(index, line.itemId, storeId);
        if (!found) continue;
        covered.push({ line, storeId, found });
        cost += found.offer.priceCents * line.quantity;
      }
      if (covered.length === 0) continue;
      if (best == null || covered.length > best.covered.length || (covered.length === best.covered.length && cost < best.cost)) {
        best = { storeId, covered, cost };
      }
    }
    if (!best) break;
    assigned.push(...best.covered);
    used.add(best.storeId);
    const taken = new Set(best.covered.map((entry) => entry.line.itemId));
    remaining = remaining.filter((line) => !taken.has(line.itemId));
  }

  return { assigned, unresolved: remaining };
}

export interface LadderRow {
  plan: Plan;
  /** Cents saved versus the headline Store winner. Always positive. */
  savingsCents: number;
  stops: number;
}

export interface OptimizationResult {
  /** The headline: the best Store to anchor the trip on. */
  winner: Plan;
  /** The realistic alternative trip — the next-best anchored Plan, never the winner. */
  runnerUp: Plan | null;
  /** Multi-Stop Plans that genuinely beat the winner — the upsell, not the headline. */
  ladder: LadderRow[];
  /** Every selected Store's anchored Plan, best first. */
  perStore: { storeId: string; plan: Plan }[];
  /** Items no selected Store carries. The Plan cannot be completed without these. */
  unavailableItemIds: string[];
}

/** All subsets of `items` with exactly `size` members. */
function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (size > items.length) return [];
  const result: T[][] = [];
  const walk = (start: number, current: T[]) => {
    if (current.length === size) {
      result.push([...current]);
      return;
    }
    for (let i = start; i < items.length; i++) {
      current.push(items[i]);
      walk(i + 1, current);
      current.pop();
    }
  };
  walk(0, []);
  return result;
}

/**
 * Ranks anchored Plans for the headline.
 *
 * Order matters and is deliberate: completeness first (a Plan that can't buy
 * everything is not a better answer), then **Stop count before price**, because
 * ADR 0002 makes the headline the cheapest *single* Store. Cheaper multi-stop
 * plans are not suppressed — they appear in the savings ladder, priced honestly
 * against the extra stop.
 */
function comparePlans(a: Plan, b: Plan): number {
  if (a.unavailableItemIds.length !== b.unavailableItemIds.length) {
    return a.unavailableItemIds.length - b.unavailableItemIds.length;
  }
  if (a.storeIds.length !== b.storeIds.length) return a.storeIds.length - b.storeIds.length;
  if (a.totalCents !== b.totalCents) return a.totalCents - b.totalCents;
  return a.driveMinutes - b.driveMinutes;
}

/**
 * Produces the headline Store winner, the runner-up, and the savings ladder.
 *
 * Brute force is correct and instant here — with 8 selectable stores the
 * largest search is C(8,3) = 56 subsets — so there is no reason to reach for a
 * heuristic that could return a wrong "best".
 */
export function optimize(
  index: OfferIndex,
  basket: BasketLine[],
  selectedStoreIds: string[],
  maxStops = 3,
): OptimizationResult {
  if (selectedStoreIds.length === 0) {
    const empty = planForStoreSet(index, basket, []);
    return { winner: empty, runnerUp: null, ladder: [], perStore: [], unavailableItemIds: empty.unavailableItemIds };
  }

  const plans = selectedStoreIds.map((storeId) => anchoredPlan(index, basket, selectedStoreIds, storeId));

  // An anchor that contributes nothing isn't a real "shop here" answer — it is
  // some other store's plan wearing the wrong name, and it used to be able to
  // win the headline and then render "WinCo doesn't carry X — picked up at
  // WinCo".
  const viable = plans.filter((plan) => plan.assignments.some((a) => a.storeId === plan.anchorId));
  const ranked = (viable.length > 0 ? viable : plans).slice().sort(comparePlans);

  const winner = ranked[0] ?? planForStoreSet(index, basket, selectedStoreIds);
  const runnerUp = ranked.find((plan) => plan.anchorId !== winner.anchorId) ?? null;

  const ladder: LadderRow[] = [];
  const cap = Math.min(maxStops, selectedStoreIds.length);
  for (let size = 2; size <= cap; size++) {
    let bestForSize: Plan | null = null;
    for (const subset of combinations(selectedStoreIds, size)) {
      const plan = planForStoreSet(index, basket, subset);
      // A subset that doesn't actually need all its stores is already covered
      // by a smaller size; skip it so the ladder's stop counts are truthful.
      if (plan.storeIds.length !== size) continue;
      // A subset that can't supply everything the winner can is NOT cheaper —
      // its "saving" is just the price of the item it silently dropped.
      if (plan.unavailableItemIds.length > winner.unavailableItemIds.length) continue;
      if (bestForSize == null || comparePlans(plan, bestForSize) < 0) bestForSize = plan;
    }
    if (!bestForSize) continue;
    if (bestForSize.totalCents >= winner.totalCents) continue;
    ladder.push({
      plan: bestForSize,
      savingsCents: winner.totalCents - bestForSize.totalCents,
      stops: bestForSize.storeIds.length,
    });
  }

  return {
    winner,
    runnerUp,
    ladder: ladder.sort((a, b) => b.savingsCents - a.savingsCents),
    // Every entry in `ranked` is an anchored plan, so the narrowing always
    // succeeds; filtering rather than casting keeps that guarantee checkable.
    perStore: ranked.flatMap((plan) => (plan.anchorId == null ? [] : [{ storeId: plan.anchorId, plan }])),
    unavailableItemIds: winner.unavailableItemIds,
  };
}
