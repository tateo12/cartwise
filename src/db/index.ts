import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

/**
 * Persistence on Node 24's built-in SQLite — no native dependency to compile.
 *
 * What lives here vs. in code:
 *  - The Item/Store catalog is CODE (src/data) and is projected into tables so
 *    it can be joined and aggregated in SQL.
 *  - Pinned matches, receipts, watches and basket state are USER DATA and exist
 *    only here. ADR 0001 requires them to survive re-matching and reseeding, so
 *    `reseedCatalog` must never touch those tables.
 */

/**
 * Values SQLite will accept as a bound parameter. Declared locally because
 * @types/node does not export node:sqlite's equivalent.
 */
export type SqlParam = string | number | bigint | null | Uint8Array;

const DB_PATH = process.env.CARTWISE_DB ?? path.join(process.cwd(), 'cartwise.db');

let instance: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (instance) return instance;
  instance = new DatabaseSync(DB_PATH);
  instance.exec('pragma journal_mode = wal');
  instance.exec('pragma foreign_keys = on');
  migrate(instance);
  return instance;
}

function migrate(conn: DatabaseSync): void {
  conn.exec(`
    create table if not exists items (
      id            text primary key,
      name          text not null,
      category      text not null,
      dimension     text not null,
      size_label    text not null,
      base_cents    integer not null,
      brand_name    text,
      upc           text
    );

    create table if not exists stores (
      id                  text primary key,
      chain_id            text not null,
      banner              text not null,
      label               text not null,
      address             text not null,
      kroger_location_id  text,
      drive_minutes       integer not null,
      provider            text not null,
      -- Geocoded position, for route distance and fuel cost.
      lat                 real,
      lon                 real
    );

    create table if not exists products (
      id             text primary key,
      item_id        text not null references items(id),
      chain_id       text not null,
      brand          text not null,
      name           text not null,
      size_label     text not null,
      size_base      real not null,
      dimension      text not null,
      pack_multiple  integer not null,
      upc            text,
      confidence     text not null
    );
    create index if not exists idx_products_item on products(item_id);

    create table if not exists offers (
      product_id           text not null references products(id),
      store_id             text not null references stores(id),
      price_cents          integer not null,
      regular_price_cents  integer,
      stock                text not null,
      provenance           text not null,
      fetched_at           text not null,
      -- Retailer's own UPC for the matched product. Cart push needs it.
      source_upc           text,
      primary key (product_id, store_id)
    );
    create index if not exists idx_offers_store on offers(store_id);

    create table if not exists price_history (
      product_id   text not null references products(id),
      store_id     text not null references stores(id),
      date         text not null,
      price_cents  integer not null,
      on_promo     integer not null default 0,
      -- Live prices must be judged against live history, never seeded points.
      provenance   text not null default 'seed',
      primary key (product_id, store_id, date)
    );

    -- ── user data below: never dropped by a reseed ──────────────────────────

    create table if not exists pinned_matches (
      product_id  text not null,
      item_id     text not null,
      created_at  text not null,
      primary key (product_id)
    );

    -- Home position and vehicle, for route distance and fuel cost.
    create table if not exists app_settings (
      key    text primary key,
      value  text not null
    );

    create table if not exists selected_stores (
      store_id  text primary key
    );

    create table if not exists basket (
      item_id   text primary key,
      quantity  integer not null
    );

    create table if not exists watches (
      item_id       text primary key,
      target_cents  integer,
      created_at    text not null
    );

    create table if not exists receipts (
      id            integer primary key autoincrement,
      store_id      text not null,
      purchased_at  text not null,
      total_cents   integer not null,
      -- 1 for the sample trips created by the seeder. Without this flag the
      -- seeded trips were indistinguishable from real ones and got badged
      -- "You" under copy claiming they were prices the user actually paid.
      seeded        integer not null default 0
    );

    create table if not exists receipt_lines (
      id           integer primary key autoincrement,
      receipt_id   integer not null references receipts(id) on delete cascade,
      item_id      text not null,
      price_cents  integer not null,
      quantity     integer not null
    );

    -- OAuth tokens for a customer-authorised retailer account (Kroger cart).
    create table if not exists retailer_tokens (
      provider       text primary key,
      access_token   text not null,
      refresh_token  text,
      expires_at     text not null,
      created_at     text not null
    );

    create table if not exists pantry (
      item_id             text primary key,
      last_purchased_at   text,
      purchase_count      integer not null default 0,
      is_staple           integer not null default 0
    );
  `);

  addMissingColumns(conn);
}

/**
 * Adds columns introduced after a database file was first created.
 *
 * `create table if not exists` is a NO-OP on an existing table, so a column
 * added to the DDL above never appears for anyone who already has a db file —
 * their `/receipts` page 500s on `no such column: r.seeded` and the seeder
 * throws. Only a fresh database masks that, which is exactly why this was
 * missed the first time.
 */
function addMissingColumns(conn: DatabaseSync): void {
  const ensure = (table: string, column: string, definition: string): void => {
    const columns = conn.prepare(`pragma table_info(${table})`).all() as unknown as { name: string }[];
    if (columns.length === 0) return;
    if (columns.some((existing) => existing.name === column)) return;
    conn.exec(`alter table ${table} add column ${column} ${definition}`);
  };

  ensure('receipts', 'seeded', 'integer not null default 0');
  // The retailer's own barcode, needed to push items into their cart.
  ensure('offers', 'source_upc', 'text');
  // Coordinates, so a multi-stop route can be measured rather than guessed.
  ensure('stores', 'lat', 'real');
  ensure('stores', 'lon', 'real');
  // Live prices must accumulate their own history: a deal verdict computed from
  // 90 days of seeded history is fiction once the current price is real.
  ensure('price_history', 'provenance', "text not null default 'seed'");
}

/**
 * Typed query helpers.
 *
 * SQLite is dynamically typed, so the driver honestly types every row as
 * `Record<string, SQLOutputValue>`. These three functions are the ONLY place
 * that cast is allowed to happen — the boundary where type information really
 * does stop. Casting at each call site instead would hide genuine column/shape
 * mismatches inside business logic.
 */
export function all<T>(sql: string, ...params: SqlParam[]): T[] {
  return db().prepare(sql).all(...params) as unknown as T[];
}

export function get<T>(sql: string, ...params: SqlParam[]): T | undefined {
  return db().prepare(sql).get(...params) as unknown as T | undefined;
}

export function run(sql: string, ...params: SqlParam[]): { changes: number; lastInsertRowid: number } {
  const result = db().prepare(sql).run(...params);
  return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
}

/** Counts rows in a table. Table name is interpolated, so callers must pass literals. */
export function countRows(table: string): number {
  return Number(get<{ c: number }>(`select count(*) as c from ${table}`)?.c ?? 0);
}

/** True when the catalog has been projected at least once. */
export function isSeeded(): boolean {
  return countRows('offers') > 0;
}

/**
 * Clears and rebuilds the derived catalog tables ONLY.
 * User data (pinned matches, receipts, basket, watches, pantry) is untouched by
 * design — losing a user's corrections to refresh prices would be a data-loss
 * bug, not a refresh.
 */
export function clearCatalog(): void {
  const conn = db();
  conn.exec('delete from price_history');
  conn.exec('delete from offers');
  conn.exec('delete from products');
  conn.exec('delete from items');
  conn.exec('delete from stores');
}

let txDepth = 0;

/**
 * Runs `fn` inside a transaction, re-entrantly.
 *
 * SQLite rejects `BEGIN` inside `BEGIN`, so nesting uses SAVEPOINTs. The
 * previous version worked only because no call site happened to nest — the
 * first refactor that wrapped one `tx()` in another would have crashed with
 * "cannot start a transaction within a transaction".
 */
export function tx<T>(fn: () => T): T {
  const conn = db();
  const isOutermost = txDepth === 0;
  const savepoint = `cartwise_sp_${txDepth}`;

  conn.exec(isOutermost ? 'begin' : `savepoint ${savepoint}`);
  txDepth++;

  try {
    const result = fn();
    txDepth--;
    conn.exec(isOutermost ? 'commit' : `release ${savepoint}`);
    return result;
  } catch (error) {
    txDepth--;
    try {
      conn.exec(isOutermost ? 'rollback' : `rollback to ${savepoint}`);
    } catch {
      // SQLite may already have rolled back (e.g. on an I/O error), in which
      // case the ROLLBACK itself throws. Swallow it so the ORIGINAL failure is
      // what surfaces — masking the real cause with a bookkeeping error makes
      // the actual bug unfindable.
    }
    throw error;
  }
}
