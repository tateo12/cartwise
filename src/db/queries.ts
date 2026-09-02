import type { BasketLine, Offer, Product, Provenance, Store } from '@/core/domain';
import type { OfferIndex } from '@/core/optimizer';
import { offerKey } from '@/core/optimizer';
import type { PricePoint } from '@/core/history';
import { DEFAULT_VEHICLE } from '@/core/geo';
import { all, get, run, db, tx } from './index';
import { ensureSeeded } from './seed';

/**
 * The read/write layer the UI talks to. Every export calls `ensureSeeded()`
 * first, so a fresh clone works with no setup step.
 *
 * Pinned matches are applied HERE, at read time, rather than baked into the
 * products table — that keeps the user's corrections authoritative even after a
 * reseed regenerates every derived row (ADR 0001).
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

interface OfferRow {
  product_id: string;
  store_id: string;
  price_cents: number;
  regular_price_cents: number | null;
  stock: string;
  provenance: string;
  fetched_at: string;
  source_upc: string | null;
}

interface StoreRow {
  id: string;
  chain_id: string;
  banner: string;
  label: string;
  address: string;
  kroger_location_id: string | null;
  drive_minutes: number;
  provider: string;
  lat: number | null;
  lon: number | null;
}

interface ItemRow {
  id: string;
  name: string;
  category: string;
  dimension: string;
  size_label: string;
  brand_name: string | null;
  upc: string | null;
}

export interface ItemRecord {
  id: string;
  name: string;
  category: string;
  dimension: 'mass' | 'volume' | 'count';
  sizeLabel: string;
  brandName: string | null;
  upc: string | null;
}

function toProduct(row: ProductRow, pinned: Map<string, string>): Product {
  const pinnedItemId = pinned.get(row.id);
  return {
    id: row.id,
    itemId: pinnedItemId ?? row.item_id,
    chainId: row.chain_id,
    brand: row.brand,
    name: row.name,
    sizeLabel: row.size_label,
    sizeBase: Number(row.size_base),
    dimension: row.dimension as Product['dimension'],
    packMultiple: Number(row.pack_multiple),
    upc: row.upc ?? undefined,
    // A user's pin outranks whatever the matcher inferred.
    confidence: pinnedItemId ? 'pinned' : (row.confidence as Product['confidence']),
  };
}

function toOffer(row: OfferRow): Offer {
  return {
    productId: row.product_id,
    storeId: row.store_id,
    priceCents: Number(row.price_cents),
    regularPriceCents: row.regular_price_cents == null ? null : Number(row.regular_price_cents),
    stock: row.stock as Offer['stock'],
    provenance: row.provenance as Provenance,
    fetchedAt: row.fetched_at,
    sourceUpc: row.source_upc ?? undefined,
  };
}

function toStore(row: StoreRow): Store {
  return {
    id: row.id,
    chainId: row.chain_id,
    banner: row.banner,
    label: row.label,
    address: row.address,
    krogerLocationId: row.kroger_location_id ?? undefined,
    driveMinutes: Number(row.drive_minutes),
    lat: Number(row.lat ?? 0),
    lon: Number(row.lon ?? 0),
  };
}

function toItem(row: ItemRow): ItemRecord {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    dimension: row.dimension as ItemRecord['dimension'],
    sizeLabel: row.size_label,
    brandName: row.brand_name,
    upc: row.upc,
  };
}

export function pinnedMatches(): Map<string, string> {
  ensureSeeded();
  const rows = all<{ product_id: string; item_id: string }>('select product_id, item_id from pinned_matches');
  return new Map(rows.map((r) => [r.product_id, r.item_id]));
}

export function allStores(): Store[] {
  ensureSeeded();
  return all<StoreRow>('select * from stores').map(toStore);
}

export function allItems(): ItemRecord[] {
  ensureSeeded();
  return all<ItemRow>(
    'select id, name, category, dimension, size_label, brand_name, upc from items order by category, name',
  ).map(toItem);
}

export function itemRecord(itemId: string): ItemRecord | null {
  ensureSeeded();
  const row = get<ItemRow>(
    'select id, name, category, dimension, size_label, brand_name, upc from items where id = ?',
    itemId,
  );
  return row ? toItem(row) : null;
}

/** Every Product for one Item, with its Offer at each Store of that chain. */
export function productsForItem(itemId: string): { product: Product; offers: Offer[] }[] {
  ensureSeeded();
  const pinned = pinnedMatches();
  const products = all<ProductRow>('select * from products where item_id = ?', itemId).map((r) => toProduct(r, pinned));
  return products.map((product) => ({
    product,
    offers: all<OfferRow>('select * from offers where product_id = ?', product.id).map(toOffer),
  }));
}

/**
 * Builds the in-memory index the optimizer runs against.
 *
 * The catalog is a few hundred products, so loading it wholesale is simpler and
 * faster than round-tripping per Item. Past a few thousand rows this should
 * become a per-basket query.
 */
export function buildOfferIndex(): OfferIndex {
  ensureSeeded();
  const pinned = pinnedMatches();

  const products = all<ProductRow>('select * from products').map((r) => toProduct(r, pinned));
  const offers = all<OfferRow>('select * from offers').map(toOffer);
  const stores = allStores();

  const productsByItem = new Map<string, Product[]>();
  for (const product of products) {
    const list = productsByItem.get(product.itemId) ?? [];
    list.push(product);
    productsByItem.set(product.itemId, list);
  }

  return {
    productsByItem,
    offers: new Map(offers.map((o) => [offerKey(o.productId, o.storeId), o])),
    storesById: new Map(stores.map((s) => [s.id, s])),
  };
}

export function selectedStoreIds(): string[] {
  ensureSeeded();
  return all<{ store_id: string }>('select store_id from selected_stores').map((r) => r.store_id);
}

export function setSelectedStores(storeIds: string[]): void {
  ensureSeeded();
  // Atomic: a failure partway through must not leave the user with a half
  // selection, which would silently change every total in the app.
  tx(() => {
    db().exec('delete from selected_stores');
    for (const id of storeIds) run('insert into selected_stores (store_id) values (?)', id);
  });
}

export function basket(): BasketLine[] {
  ensureSeeded();
  return all<{ item_id: string; quantity: number }>('select item_id, quantity from basket').map((r) => ({
    itemId: r.item_id,
    quantity: Number(r.quantity),
  }));
}

/** Sets a basket quantity. Zero or less removes the line entirely. */
export function setBasketQuantity(itemId: string, quantity: number): void {
  ensureSeeded();
  if (quantity <= 0) {
    run('delete from basket where item_id = ?', itemId);
    return;
  }
  run(
    'insert into basket (item_id, quantity) values (?,?) on conflict(item_id) do update set quantity = excluded.quantity',
    itemId,
    quantity,
  );
}

export function clearBasket(): void {
  ensureSeeded();
  db().exec('delete from basket');
}

/** Price history for one Product at one Store, oldest first. */
export function priceHistory(productId: string, storeId: string): PricePoint[] {
  ensureSeeded();
  return all<{ date: string; price_cents: number; on_promo: number; provenance: string }>(
    'select date, price_cents, on_promo, provenance from price_history where product_id = ? and store_id = ? order by date asc',
    productId,
    storeId,
  ).map((r) => ({
    date: r.date,
    priceCents: Number(r.price_cents),
    onPromo: Number(r.on_promo) === 1,
    provenance: r.provenance as PricePoint['provenance'],
  }));
}

export function pinMatch(productId: string, itemId: string): void {
  ensureSeeded();
  run(
    'insert into pinned_matches (product_id, item_id, created_at) values (?,?,?) on conflict(product_id) do update set item_id = excluded.item_id',
    productId,
    itemId,
    new Date().toISOString(),
  );
}

export function unpinMatch(productId: string): void {
  ensureSeeded();
  run('delete from pinned_matches where product_id = ?', productId);
}

/**
 * Where trips start and end, plus the vehicle they are driven in.
 *
 * Defaults are deliberately generic and clearly editable: a fuel figure the
 * user has not set is a guess, and the UI says so rather than presenting it as
 * their number.
 */
export interface TripSettings {
  home: { lat: number; lon: number };
  mpg: number;
  fuelPriceCents: number;
  /** False until the user has actually set their home position. */
  homeIsSet: boolean;
}

/** Downtown Salt Lake, purely so the maths has a starting point. */
const DEFAULT_HOME = { lat: 40.7392, lon: -111.8757 };

function settingValue(key: string): string | null {
  ensureSeeded();
  return get<{ value: string }>('select value from app_settings where key = ?', key)?.value ?? null;
}

export function tripSettings(): TripSettings {
  const lat = settingValue('home_lat');
  const lon = settingValue('home_lon');
  const mpg = settingValue('mpg');
  const fuel = settingValue('fuel_price_cents');

  return {
    home: lat && lon ? { lat: Number(lat), lon: Number(lon) } : DEFAULT_HOME,
    mpg: mpg ? Number(mpg) : DEFAULT_VEHICLE.mpg,
    fuelPriceCents: fuel ? Number(fuel) : DEFAULT_VEHICLE.fuelPriceCents,
    homeIsSet: lat != null && lon != null,
  };
}

export function setTripSettings(update: Partial<{ lat: number; lon: number; mpg: number; fuelPriceCents: number }>): void {
  ensureSeeded();
  const write = (key: string, value: number) =>
    run(
      'insert into app_settings (key, value) values (?,?) on conflict(key) do update set value = excluded.value',
      key,
      String(value),
    );
  tx(() => {
    if (update.lat != null) write('home_lat', update.lat);
    if (update.lon != null) write('home_lon', update.lon);
    if (update.mpg != null) write('mpg', update.mpg);
    if (update.fuelPriceCents != null) write('fuel_price_cents', update.fuelPriceCents);
  });
}

export interface WatchRecord {
  itemId: string;
  targetCents: number | null;
  createdAt: string;
}

export function watches(): WatchRecord[] {
  ensureSeeded();
  return all<{ item_id: string; target_cents: number | null; created_at: string }>(
    'select item_id, target_cents, created_at from watches order by created_at desc',
  ).map((r) => ({
    itemId: r.item_id,
    targetCents: r.target_cents == null ? null : Number(r.target_cents),
    createdAt: r.created_at,
  }));
}

export function addWatch(itemId: string, targetCents: number | null): void {
  ensureSeeded();
  run(
    'insert into watches (item_id, target_cents, created_at) values (?,?,?) on conflict(item_id) do update set target_cents = excluded.target_cents',
    itemId,
    targetCents,
    new Date().toISOString(),
  );
}

export function removeWatch(itemId: string): void {
  ensureSeeded();
  run('delete from watches where item_id = ?', itemId);
}

export interface PantryRecord {
  itemId: string;
  lastPurchasedAt: string | null;
  purchaseCount: number;
  isStaple: boolean;
}

export function pantry(): PantryRecord[] {
  ensureSeeded();
  return all<{ item_id: string; last_purchased_at: string | null; purchase_count: number; is_staple: number }>(
    'select item_id, last_purchased_at, purchase_count, is_staple from pantry order by purchase_count desc, item_id asc',
  ).map((r) => ({
    itemId: r.item_id,
    lastPurchasedAt: r.last_purchased_at,
    purchaseCount: Number(r.purchase_count),
    isStaple: Number(r.is_staple) === 1,
  }));
}

export interface ReceiptRecord {
  id: number;
  storeId: string;
  purchasedAt: string;
  totalCents: number;
  lineCount: number;
  /** True for the seeder's sample trips — never claim these as user prices. */
  seeded: boolean;
}

export function receipts(): ReceiptRecord[] {
  ensureSeeded();
  return all<{
    id: number; store_id: string; purchased_at: string; total_cents: number; line_count: number; seeded: number;
  }>(`
    select r.id, r.store_id, r.purchased_at, r.total_cents, r.seeded, count(l.id) as line_count
    from receipts r left join receipt_lines l on l.receipt_id = r.id
    group by r.id order by r.purchased_at desc
  `).map((r) => ({
    id: Number(r.id),
    storeId: r.store_id,
    purchasedAt: r.purchased_at,
    totalCents: Number(r.total_cents),
    lineCount: Number(r.line_count),
    seeded: Number(r.seeded) === 1,
  }));
}

/**
 * True when the user has already logged a real (non-sample) trip to this Store
 * on this date.
 *
 * Guards against double-logging: the "I bought this" button hides itself in
 * component state only, so a reload, a second tab, or back-navigation re-shows
 * it — and each press previously inserted another receipt and bumped every
 * item's `purchase_count` again, which would eventually mark the whole basket
 * as staples.
 */
export function userReceiptExists(storeId: string, purchasedAt: string): boolean {
  ensureSeeded();
  const row = get<{ c: number }>(
    'select count(*) as c from receipts where store_id = ? and purchased_at = ? and seeded = 0',
    storeId,
    purchasedAt,
  );
  return Number(row?.c ?? 0) > 0;
}

export interface ReceiptLineRecord {
  itemId: string;
  priceCents: number;
  quantity: number;
}

export function receiptLines(receiptId: number): ReceiptLineRecord[] {
  ensureSeeded();
  return all<{ item_id: string; price_cents: number; quantity: number }>(
    'select item_id, price_cents, quantity from receipt_lines where receipt_id = ? order by id',
    receiptId,
  ).map((r) => ({ itemId: r.item_id, priceCents: Number(r.price_cents), quantity: Number(r.quantity) }));
}

/**
 * Records a shopping trip the user actually took, at the prices they actually
 * paid. This is `provenance: 'user'` data — the only prices in the system that
 * are neither fetched nor seeded — and it feeds the staples list.
 */
export function recordReceipt(
  storeId: string,
  purchasedAt: string,
  lines: ReceiptLineRecord[],
): number {
  ensureSeeded();
  const total = lines.reduce((sum, l) => sum + l.priceCents * l.quantity, 0);
  return tx(() => recordReceiptRows(storeId, purchasedAt, lines, total));
}

/** Inner write, always called inside a transaction. */
function recordReceiptRows(
  storeId: string,
  purchasedAt: string,
  lines: ReceiptLineRecord[],
  total: number,
): number {
  const receiptId = run(
    'insert into receipts (store_id, purchased_at, total_cents) values (?,?,?)',
    storeId,
    purchasedAt,
    total,
  ).lastInsertRowid;

  for (const line of lines) {
    run(
      'insert into receipt_lines (receipt_id, item_id, price_cents, quantity) values (?,?,?,?)',
      receiptId,
      line.itemId,
      line.priceCents,
      line.quantity,
    );
    run(
      `insert into pantry (item_id, last_purchased_at, purchase_count, is_staple)
       values (?, ?, 1, 0)
       on conflict(item_id) do update set
         last_purchased_at = excluded.last_purchased_at,
         purchase_count = pantry.purchase_count + 1`,
      line.itemId,
      purchasedAt,
    );
  }
  // Bought on three or more trips is a workable definition of a staple.
  db().exec('update pantry set is_staple = 1 where purchase_count >= 3');

  return receiptId;
}
