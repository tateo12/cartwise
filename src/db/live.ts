import type { Offer, Product } from '@/core/domain';
import { CHAINS } from '@/data/stores';
import { krogerProvider } from '@/providers/kroger';
import { all, run, tx } from './index';
import { allStores } from './queries';
import { ensureSeeded } from './seed';

/**
 * Fetches real prices from live providers and writes them over the seeded rows.
 *
 * This is the call site the Kroger adapter previously lacked: without it the
 * whole live path was dead code and the sidebar's "Kroger API live" badge was
 * simply untrue while every Smith's price stayed seeded.
 */

interface ProductRow {
  id: string;
  item_id: string;
  chain_id: string;
  brand: string;
  name: string;
  size_label: string;
  size_base: number;
  dimension: string;
  pack_multiple: number;
  upc: string | null;
  confidence: string;
}

export interface RefreshReport {
  attemptedStores: number;
  /** Offers actually replaced with live data. */
  updated: number;
  /** Products the provider could not price — these KEEP their seeded offer. */
  missed: number;
  /** Offers already fresh enough to skip. */
  reused: number;
  errors: string[];
}

/**
 * How long a live price stays good.
 *
 * Grocery prices move on promo cycles, not minutes, so re-fetching the same
 * item repeatedly buys nothing and spends request budget that some retailers
 * ration tightly.
 */
const FRESH_FOR_MINUTES = 90;

/**
 * Products for one chain, optionally narrowed to specific Items.
 *
 * Narrowing is the point: pricing a 14-line basket at 4 stores is ~56 requests,
 * where refreshing the whole catalog everywhere is ~480. Fetching prices nobody
 * asked for is both slower for the user and harder to justify to the retailer.
 */
function productsForChain(chainId: string, itemIds?: string[]): Product[] {
  const rows =
    itemIds && itemIds.length > 0
      ? all<ProductRow>(
          `select * from products where chain_id = ? and item_id in (${itemIds.map(() => '?').join(',')})`,
          chainId,
          ...itemIds,
        )
      : all<ProductRow>('select * from products where chain_id = ?', chainId);
  return rows.map((row) => ({
    id: row.id,
    itemId: row.item_id,
    chainId: row.chain_id,
    brand: row.brand,
    name: row.name,
    sizeLabel: row.size_label,
    sizeBase: Number(row.size_base),
    dimension: row.dimension as Product['dimension'],
    packMultiple: Number(row.pack_multiple),
    upc: row.upc ?? undefined,
    confidence: row.confidence as Product['confidence'],
  }));
}

/**
 * Product ids whose live offer is still within the freshness window.
 *
 * Re-asking for a price that has not moved wastes the request budget, which
 * matters most at exactly the retailers that ration it hardest.
 */
function stillFresh(storeId: string, productIds: string[]): Set<string> {
  if (productIds.length === 0) return new Set();
  const cutoff = new Date(Date.now() - FRESH_FOR_MINUTES * 60_000).toISOString();
  const rows = all<{ product_id: string }>(
    `select product_id from offers
     where store_id = ? and provenance = 'live' and fetched_at > ?
       and product_id in (${productIds.map(() => '?').join(',')})`,
    storeId,
    cutoff,
    ...productIds,
  );
  return new Set(rows.map((row) => row.product_id));
}

/** Today's date in the same YYYY-MM-DD form price_history uses. */
function today(): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function writeOffers(offers: Offer[]): void {
  const date = today();
  tx(() => {
    for (const offer of offers) {
      run(
        `insert into offers (product_id, store_id, price_cents, regular_price_cents, stock, provenance, fetched_at, source_upc)
         values (?,?,?,?,?,?,?,?)
         on conflict(product_id, store_id) do update set
           price_cents = excluded.price_cents,
           regular_price_cents = excluded.regular_price_cents,
           stock = excluded.stock,
           provenance = excluded.provenance,
           fetched_at = excluded.fetched_at,
           source_upc = excluded.source_upc`,
        offer.productId,
        offer.storeId,
        offer.priceCents,
        offer.regularPriceCents,
        offer.stock,
        offer.provenance,
        offer.fetchedAt,
        offer.sourceUpc ?? null,
      );

      // Live prices must accumulate their OWN history. Without this, a real
      // Smith's price is scored by analyzeDeal against 90 days of seeded
      // history, so its "Real low" / "Fake sale" verdict is fiction.
      run(
        `insert into price_history (product_id, store_id, date, price_cents, on_promo, provenance)
         values (?,?,?,?,?,'live')
         on conflict(product_id, store_id, date) do update set
           price_cents = excluded.price_cents,
           on_promo = excluded.on_promo,
           provenance = excluded.provenance`,
        offer.productId,
        offer.storeId,
        date,
        offer.priceCents,
        offer.regularPriceCents != null ? 1 : 0,
      );
    }
  });
}

/**
 * Refreshes every store served by an available live provider.
 *
 * A product the provider cannot price is left on its seeded offer rather than
 * being deleted or zeroed — a missing live price is not evidence the store
 * stopped carrying the item.
 */
export async function refreshLiveOffers(options?: {
  /** Limit to these Items. Omit to refresh everything (rarely what you want). */
  itemIds?: string[];
  /** Limit to these Stores. Omit for all live-capable stores. */
  storeIds?: string[];
}): Promise<RefreshReport> {
  ensureSeeded();
  const report: RefreshReport = { attemptedStores: 0, updated: 0, missed: 0, reused: 0, errors: [] };

  if (!krogerProvider.isAvailable()) {
    report.errors.push('Kroger credentials are not configured.');
    return report;
  }

  // Pre-flight the credentials so rejected keys read as an auth error rather
  // than as "Kroger had no matching products".
  const auth = await krogerProvider.checkAuth?.();
  if (auth && !auth.ok) {
    report.errors.push(auth.reason ?? 'Kroger authentication failed.');
    return report;
  }

  const krogerChainIds = new Set(CHAINS.filter((chain) => chain.provider === 'kroger').map((chain) => chain.id));
  const stores = allStores().filter(
    (store) =>
      krogerChainIds.has(store.chainId) &&
      store.krogerLocationId &&
      (!options?.storeIds || options.storeIds.includes(store.id)),
  );

  for (const store of stores) {
    report.attemptedStores++;
    const products = productsForChain(store.chainId, options?.itemIds);

    // Skip anything fetched recently. Re-asking for a price that has not moved
    // wastes the request budget that matters most when it is rationed.
    const fresh = stillFresh(store.id, products.map((product) => product.id));
    const needed = products.filter((product) => !fresh.has(product.id));
    report.reused += fresh.size;
    if (needed.length === 0) continue;

    try {
      const offers = await krogerProvider.fetchOffers(store, needed);
      writeOffers(offers);
      report.updated += offers.length;
      report.missed += needed.length - offers.length;
    } catch (error) {
      report.errors.push(`${store.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return report;
}

export interface LiveStatus {
  /** True when credentials exist, whether or not a refresh has run. */
  configured: boolean;
  /** How many offers currently hold live data. */
  liveOfferCount: number;
  /** Most recent live fetch timestamp, if any. */
  lastRefreshedAt: string | null;
  /**
   * Live points in price_history. Deal verdicts read history, so while this is
   * small every "Real low" on a live price is really a judgement about seeded
   * numbers — worth saying out loud rather than implying precision.
   */
  liveHistoryPoints: number;
}

/**
 * Live-price status.
 *
 * Distinguishes "credentials present" from "live data actually loaded", because
 * conflating them is exactly how the sidebar came to claim live prices while
 * serving seeded ones.
 */
export function liveStatus(): LiveStatus {
  ensureSeeded();
  const row = all<{ c: number; last: string | null }>(
    "select count(*) as c, max(fetched_at) as last from offers where provenance = 'live'",
  )[0];
  const history = all<{ c: number }>(
    "select count(*) as c from price_history where provenance = 'live'",
  )[0];

  return {
    configured: krogerProvider.isAvailable(),
    liveOfferCount: Number(row?.c ?? 0),
    lastRefreshedAt: row?.last ?? null,
    liveHistoryPoints: Number(history?.c ?? 0),
  };
}
