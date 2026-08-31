import type { Offer, Product, Store } from '@/core/domain';
import { analyzeDeal, type DealSignal } from '@/core/history';
import { bestAtStore, type OfferIndex } from '@/core/optimizer';
import { formatUnitPrice, unitPriceCents } from '@/core/units';
import { allItems, buildOfferIndex, priceHistory, selectedStoreIds, type ItemRecord } from '@/db/queries';

/**
 * Search and Item-detail view models.
 *
 * The search bar answers a different question from the dashboard: "cheapest
 * place for THIS item", per-Item, ignoring the basket entirely (ADR 0002).
 */

export interface StoreQuote {
  store: Store;
  product: Product;
  offer: Offer;
  unitPrice: string;
  /** Cents per base unit — the sort key that makes bulk comparable. */
  unitPriceCents: number | null;
  deal: DealSignal;
  /** Cents more than the cheapest quote for this Item. Zero for the winner. */
  premiumCents: number;
}

export interface ItemQuotes {
  item: ItemRecord;
  quotes: StoreQuote[];
  /** Selected stores that do not carry this Item at all. */
  missingStores: Store[];
  best: StoreQuote | null;
}

/**
 * Ranks every selected Store for one Item.
 *
 * Ordering is by PACK price, because that is what the user hands over at the
 * till. Unit price is shown alongside so a bigger-pack win is still visible.
 */
export function quotesForItem(itemId: string, index?: OfferIndex): ItemQuotes | null {
  const idx = index ?? buildOfferIndex();
  const item = allItems().find((i) => i.id === itemId);
  if (!item) return null;

  const selected = selectedStoreIds();
  const quotes: StoreQuote[] = [];
  const missingStores: Store[] = [];

  for (const storeId of selected) {
    const store = idx.storesById.get(storeId);
    if (!store) continue;

    const found = bestAtStore(idx, itemId, storeId);
    if (!found) {
      missingStores.push(store);
      continue;
    }

    const perUnit = unitPriceCents(found.offer.priceCents, found.product.sizeBase, found.product.packMultiple);
    quotes.push({
      store,
      product: found.product,
      offer: found.offer,
      unitPrice: formatUnitPrice(perUnit, found.product.dimension),
      unitPriceCents: perUnit,
      deal: analyzeDeal(
        priceHistory(found.product.id, storeId),
        found.offer.priceCents,
        found.offer.regularPriceCents != null,
        found.offer.provenance,
      ),
      premiumCents: 0,
    });
  }

  quotes.sort((a, b) => a.offer.priceCents - b.offer.priceCents);
  const cheapest = quotes[0]?.offer.priceCents ?? 0;
  for (const quote of quotes) quote.premiumCents = quote.offer.priceCents - cheapest;

  return { item, quotes, missingStores, best: quotes[0] ?? null };
}

/**
 * Matches a free-text query to Items.
 *
 * Scoring is deliberately simple and explainable: exact name, then prefix,
 * then substring, then category. A cleverer fuzzy ranker would be harder to
 * trust when it returns something surprising.
 */
export function searchItems(query: string, limit = 12): ItemRecord[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const scored = allItems()
    .map((item) => {
      const name = item.name.toLowerCase();
      const brand = item.brandName?.toLowerCase() ?? '';
      let score = 0;
      if (name === needle) score = 100;
      else if (name.startsWith(needle)) score = 80;
      else if (name.includes(needle)) score = 60;
      else if (brand.includes(needle)) score = 50;
      else if (item.category.toLowerCase().includes(needle)) score = 30;
      else if (needle.split(/\s+/).every((word) => name.includes(word))) score = 20;
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));

  return scored.slice(0, limit).map((entry) => entry.item);
}

export interface SearchResult {
  query: string;
  results: ItemQuotes[];
}

export function buildSearchResults(query: string): SearchResult {
  const index = buildOfferIndex();
  const items = searchItems(query);
  return {
    query,
    results: items.map((item) => quotesForItem(item.id, index)).filter((r): r is ItemQuotes => r != null),
  };
}
