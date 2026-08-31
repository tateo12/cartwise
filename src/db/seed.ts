import { DEFAULT_SELECTED_STORE_IDS, STORES, chainById } from '@/data/stores';
import { DEFAULT_BASKET, ITEMS } from '@/data/items';
import { buildProducts, shelfPriceCents, stockFor } from '@/core/pricing';
import { clearCatalog, countRows, db, isSeeded, tx } from './index';

/**
 * Projects the code-defined catalog into SQLite and generates price history.
 *
 * This lives inside the app rather than in a standalone script so that it runs
 * under Next's Node runtime, where path aliases and TypeScript already work.
 *
 * Re-running is safe: derived tables are rebuilt, user data is never touched.
 */

const HISTORY_DAYS = 90;

function isoDate(daysAgo: number): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

export interface SeedReport {
  items: number;
  stores: number;
  products: number;
  offers: number;
  historyPoints: number;
}

export function seedCatalog(): SeedReport {
  const conn = db();
  const products = buildProducts();
  const now = new Date().toISOString();
  let offers = 0;
  let historyPoints = 0;

  tx(() => {
    clearCatalog();

    const insertItem = conn.prepare(
      'insert into items (id, name, category, dimension, size_label, base_cents, brand_name, upc) values (?,?,?,?,?,?,?,?)',
    );
    for (const item of ITEMS) {
      insertItem.run(
        item.id,
        item.name,
        item.category,
        item.dimension,
        item.sizeLabel,
        item.baseCents,
        item.nameBrand?.brand ?? null,
        item.nameBrand?.upc ?? null,
      );
    }

    const insertStore = conn.prepare(
      'insert into stores (id, chain_id, banner, label, address, kroger_location_id, drive_minutes, provider) values (?,?,?,?,?,?,?,?)',
    );
    for (const store of STORES) {
      insertStore.run(
        store.id,
        store.chainId,
        store.banner,
        store.label,
        store.address,
        store.krogerLocationId ?? null,
        store.driveMinutes,
        chainById.get(store.chainId)?.provider ?? 'seed',
      );
    }

    const insertProduct = conn.prepare(
      'insert into products (id, item_id, chain_id, brand, name, size_label, size_base, dimension, pack_multiple, upc, confidence) values (?,?,?,?,?,?,?,?,?,?,?)',
    );
    for (const p of products) {
      insertProduct.run(
        p.id, p.itemId, p.chainId, p.brand, p.name, p.sizeLabel,
        p.sizeBase, p.dimension, p.packMultiple, p.upc ?? null, p.confidence,
      );
    }

    const insertOffer = conn.prepare(
      'insert into offers (product_id, store_id, price_cents, regular_price_cents, stock, provenance, fetched_at) values (?,?,?,?,?,?,?)',
    );
    const insertHistory = conn.prepare(
      'insert into price_history (product_id, store_id, date, price_cents, on_promo) values (?,?,?,?,?)',
    );

    for (const store of STORES) {
      for (const product of products) {
        if (product.chainId !== store.chainId) continue;

        const today = shelfPriceCents(product, store, 0);
        insertOffer.run(
          product.id, store.id, today.priceCents, today.regularPriceCents,
          stockFor(product, store), 'seed', now,
        );
        offers++;

        for (let daysAgo = 0; daysAgo < HISTORY_DAYS; daysAgo++) {
          const day = shelfPriceCents(product, store, daysAgo);
          insertHistory.run(
            product.id, store.id, isoDate(daysAgo),
            day.priceCents, day.regularPriceCents != null ? 1 : 0,
          );
          historyPoints++;
        }
      }
    }
  });

  seedFirstRunDefaults();

  return { items: ITEMS.length, stores: STORES.length, products: products.length, offers, historyPoints };
}

/**
 * First-run defaults only. Each block is guarded on emptiness so that a reseed
 * never clobbers a selection, basket, or purchase history the user owns.
 */
function seedFirstRunDefaults(): void {
  const conn = db();

  if (countRows('selected_stores') === 0) {
    const insert = conn.prepare('insert into selected_stores (store_id) values (?)');
    for (const id of DEFAULT_SELECTED_STORE_IDS) insert.run(id);
  }

  if (countRows('basket') === 0) {
    const insert = conn.prepare('insert into basket (item_id, quantity) values (?,?)');
    for (const line of DEFAULT_BASKET) insert.run(line.itemId, line.quantity);
  }

  if (countRows('receipts') === 0) seedPurchaseHistory();
}

/** A few past trips so the pantry and staples views have real data to show. */
function seedPurchaseHistory(): void {
  const conn = db();
  const products = buildProducts();

  // seeded = 1: these are sample trips, not prices the user paid.
  const insertReceipt = conn.prepare('insert into receipts (store_id, purchased_at, total_cents, seeded) values (?,?,?,1)');
  const insertLine = conn.prepare('insert into receipt_lines (receipt_id, item_id, price_cents, quantity) values (?,?,?,?)');
  const upsertPantry = conn.prepare(`
    insert into pantry (item_id, last_purchased_at, purchase_count, is_staple)
    values (?, ?, 1, 0)
    on conflict(item_id) do update set
      last_purchased_at = excluded.last_purchased_at,
      purchase_count = pantry.purchase_count + 1
  `);

  const trips = [
    { storeId: 'winco-redwood', daysAgo: 7 },
    { storeId: 'smiths-900e', daysAgo: 14 },
    { storeId: 'winco-redwood', daysAgo: 21 },
    { storeId: 'costco-sandy', daysAgo: 28 },
  ];

  tx(() => {
    for (const trip of trips) {
      const store = STORES.find((s) => s.id === trip.storeId);
      if (!store) continue;

      const lines = DEFAULT_BASKET.map((line) => {
        const product = products.find((p) => p.itemId === line.itemId && p.chainId === store.chainId);
        if (!product) return null;
        return {
          itemId: line.itemId,
          priceCents: shelfPriceCents(product, store, trip.daysAgo).priceCents,
          quantity: line.quantity,
        };
      }).filter((l): l is { itemId: string; priceCents: number; quantity: number } => l != null);

      if (lines.length === 0) continue;

      const total = lines.reduce((sum, l) => sum + l.priceCents * l.quantity, 0);
      const receiptId = Number(insertReceipt.run(trip.storeId, isoDate(trip.daysAgo), total).lastInsertRowid);
      for (const line of lines) {
        insertLine.run(receiptId, line.itemId, line.priceCents, line.quantity);
        upsertPantry.run(line.itemId, isoDate(trip.daysAgo));
      }
    }
    // Bought on three or more trips is a workable definition of a staple.
    conn.exec('update pantry set is_staple = 1 where purchase_count >= 3');
  });
}

/** Seeds on first access so the app is never staring at an empty database. */
export function ensureSeeded(): void {
  if (isSeeded()) return;
  seedCatalog();
}
