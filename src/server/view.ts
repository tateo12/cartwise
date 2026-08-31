import type { Assignment, Provenance, Store } from '@/core/domain';
import { analyzeDeal, type DealSignal } from '@/core/history';
import { bestAtStore, optimize, type OptimizationResult } from '@/core/optimizer';
import { formatUnitPrice, parseSize, unitPriceCents } from '@/core/units';
import { allItems, basket, buildOfferIndex, priceHistory, selectedStoreIds, type ItemRecord } from '@/db/queries';

/**
 * Assembles the dashboard view model.
 *
 * Kept out of the page component so the assembly is testable and so the page
 * stays a layout concern. Everything here is server-only.
 */

export interface BasketRow {
  item: ItemRecord;
  assignment: Assignment;
  store: Store;
  /** Formatted unit price, or "—" when the size could not be parsed. */
  unitPrice: string;
  deal: DealSignal;
}

/** One selected Store's complete-basket total, with the caveats that matter. */
export interface StoreComparison {
  storeId: string;
  totalCents: number;
  /** Stops this plan needs. A cheaper row may simply require more driving. */
  stops: number;
  /** True for the plan the dashboard headline recommends. */
  isWinner: boolean;
  forcedStopCount: number;
  unavailableCount: number;
  /**
   * True when this Store's packs deliver materially MORE product than the
   * Item's reference size (Costco, mainly). Its higher total is then not a
   * like-for-like loss, and saying so is the difference between a useful
   * comparison and a misleading one.
   */
  largerPacks: boolean;
}

export interface BasketView {
  result: OptimizationResult;
  rows: BasketRow[];
  /** Items in the basket that no selected store carries. */
  unavailable: ItemRecord[];
  selectedStores: Store[];
  comparisons: StoreComparison[];
  /**
   * The runner-up anchored Plan — the realistic alternative trip.
   * Deliberately NOT the priciest store: with a warehouse club in the mix, the
   * max is inflated by pack size rather than by price. Comes straight from the
   * optimizer, because indexing `perStore[1]` could name the winner itself on a
   * total tie.
   */
  nextBestTotalCents: number;
  runnerUpStoreId: string | null;
  /** Highest complete-basket total, used only to scale the comparison bars. */
  worstTotalCents: number;
  realLowCount: number;
  fakeSaleCount: number;
  itemCount: number;
  /** True when no store is selected, so nothing can be compared. */
  empty: boolean;
}

export function buildBasketView(): BasketView {
  const index = buildOfferIndex();
  const lines = basket();
  const selected = selectedStoreIds();
  const items = new Map(allItems().map((i) => [i.id, i]));

  const result = optimize(index, lines, selected);

  const rows: BasketRow[] = [];
  for (const assignment of result.winner.assignments) {
    const item = items.get(assignment.itemId);
    const store = index.storesById.get(assignment.storeId);
    if (!item || !store) continue;

    const history = priceHistory(assignment.product.id, assignment.storeId);
    const deal = analyzeDeal(
      history,
      assignment.offer.priceCents,
      assignment.offer.regularPriceCents != null,
      assignment.offer.provenance,
    );
    const perUnit = unitPriceCents(
      assignment.offer.priceCents,
      assignment.product.sizeBase,
      assignment.product.packMultiple,
    );

    rows.push({
      item,
      assignment,
      store,
      unitPrice: formatUnitPrice(perUnit, assignment.product.dimension),
      deal,
    });
  }

  const perStoreTotals = result.perStore.map((entry) => entry.plan.totalCents);

  // Reference size per Item, for spotting stores that sell bigger packs.
  const referenceBase = new Map<string, number>();
  for (const item of items.values()) {
    const parsed = parseSize(item.sizeLabel);
    if (parsed) referenceBase.set(item.id, parsed.sizeBase * parsed.packMultiple);
  }

  const comparisons: StoreComparison[] = result.perStore.map((entry) => ({
    storeId: entry.storeId,
    totalCents: entry.plan.totalCents,
    stops: entry.plan.storeIds.length,
    isWinner: entry.storeId === result.winner.anchorId,
    forcedStopCount: entry.plan.forcedStopIds.length,
    unavailableCount: entry.plan.unavailableItemIds.length,
    largerPacks: entry.plan.assignments.some((a) => {
      const reference = referenceBase.get(a.itemId);
      if (!reference) return false;
      return a.product.sizeBase * a.product.packMultiple > reference * 1.5;
    }),
  }));

  // Sorted by MONEY, not by the headline ranking. This panel exists to compare
  // cost, and ordering it by stop-count-then-price made a $74 plan appear below
  // a $98 one under a heading that promised comparable totals.
  comparisons.sort((a, b) => a.totalCents - b.totalCents);

  return {
    result,
    rows,
    unavailable: result.unavailableItemIds.map((id) => items.get(id)).filter((i): i is ItemRecord => i != null),
    selectedStores: selected.map((id) => index.storesById.get(id)).filter((s): s is Store => s != null),
    comparisons,
    nextBestTotalCents: result.runnerUp?.totalCents ?? 0,
    runnerUpStoreId: result.runnerUp?.anchorId ?? null,
    worstTotalCents: perStoreTotals.length ? Math.max(...perStoreTotals) : 0,
    realLowCount: rows.filter((r) => r.deal.verdict === 'real-low').length,
    fakeSaleCount: rows.filter((r) => r.deal.verdict === 'fake-sale').length,
    itemCount: lines.reduce((sum, l) => sum + l.quantity, 0),
    empty: selected.length === 0,
  };
}

/** One row of the all-prices board. */
export interface BoardRow {
  item: ItemRecord;
  bestStoreBanner: string | null;
  bestPriceCents: number | null;
  /** Provenance of the cheapest offer. ADR 0003: no price renders unbadged. */
  bestProvenance: Provenance | null;
  unitPrice: string;
  /** How many selected stores carry it. */
  carriedCount: number;
  /** Cheapest-to-priciest spread across selected stores, in cents. */
  spreadCents: number;
  quantityInBasket: number;
}

/**
 * The all-prices board.
 *
 * Deliberately skips deal analysis: that needs a 90-day history read per item
 * per store, and doing it for the whole catalog would turn a browse page into a
 * few hundred queries. Deal signals live on the Item detail page instead.
 */
export function buildPriceBoard(): { rows: BoardRow[]; categories: string[] } {
  const index = buildOfferIndex();
  const selected = selectedStoreIds();
  const quantities = new Map(basket().map((line) => [line.itemId, line.quantity]));
  const items = allItems();

  const rows: BoardRow[] = items.map((item) => {
    const prices: number[] = [];
    let best: { storeId: string; cents: number; unit: string; provenance: Provenance } | null = null;

    for (const storeId of selected) {
      const found = bestAtStore(index, item.id, storeId);
      if (!found) continue;
      prices.push(found.offer.priceCents);
      if (!best || found.offer.priceCents < best.cents) {
        best = {
          storeId,
          cents: found.offer.priceCents,
          provenance: found.offer.provenance,
          unit: formatUnitPrice(
            unitPriceCents(found.offer.priceCents, found.product.sizeBase, found.product.packMultiple),
            found.product.dimension,
          ),
        };
      }
    }

    return {
      item,
      bestStoreBanner: best ? (index.storesById.get(best.storeId)?.banner ?? null) : null,
      bestPriceCents: best?.cents ?? null,
      bestProvenance: best?.provenance ?? null,
      unitPrice: best?.unit ?? '—',
      carriedCount: prices.length,
      spreadCents: prices.length > 1 ? Math.max(...prices) - Math.min(...prices) : 0,
      quantityInBasket: quantities.get(item.id) ?? 0,
    };
  });

  return { rows, categories: [...new Set(items.map((i) => i.category))] };
}
