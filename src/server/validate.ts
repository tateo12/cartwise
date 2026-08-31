import { ITEMS } from '@/data/items';
import { STORES } from '@/data/stores';

/**
 * Server-action input guards.
 *
 * Server actions are a public HTTP surface — the arguments are whatever the
 * caller sends, not whatever the component happens to pass. Without these,
 * `quantity: NaN` produced a NOT NULL constraint 500, `quantity: 2.5` was
 * stored as a REAL and silently multiplied every line total, and an unknown
 * itemId inserted a basket row that the view filtered out of both the rows and
 * the "unavailable" list — an item that existed nowhere but the database.
 *
 * IDs are checked against the real catalog rather than a shape schema, because
 * the only meaningful definition of a valid id here is "one that exists".
 */

const ITEM_IDS = new Set(ITEMS.map((item) => item.id));
const STORE_IDS = new Set(STORES.map((store) => store.id));

/** Generous enough for any real basket, tight enough to bound the arithmetic. */
export const MAX_QUANTITY = 99;
/** $10,000 — no single grocery pack legitimately exceeds this. */
export const MAX_PRICE_CENTS = 1_000_000;

export class ValidationError extends Error {}

export function assertItemId(value: unknown): string {
  if (typeof value !== 'string' || !ITEM_IDS.has(value)) {
    throw new ValidationError(`Unknown item: ${String(value)}`);
  }
  return value;
}

export function assertStoreId(value: unknown): string {
  if (typeof value !== 'string' || !STORE_IDS.has(value)) {
    throw new ValidationError(`Unknown store: ${String(value)}`);
  }
  return value;
}

export function assertStoreIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new ValidationError('Expected a list of store ids');
  const seen = new Set<string>();
  for (const entry of value) seen.add(assertStoreId(entry));
  return [...seen];
}

/** Quantity in packs. Zero is legal — it means "remove this line". */
export function assertQuantity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_QUANTITY) {
    throw new ValidationError(`Quantity must be a whole number between 0 and ${MAX_QUANTITY}, got ${String(value)}`);
  }
  return value;
}

export function assertPriceCents(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_PRICE_CENTS) {
    throw new ValidationError(`Price must be a whole number of cents up to ${MAX_PRICE_CENTS}, got ${String(value)}`);
  }
  return value;
}

/** A price target may be omitted entirely, but must be sane if present. */
export function assertOptionalPriceCents(value: unknown): number | null {
  if (value == null) return null;
  return assertPriceCents(value);
}

export function assertIsoDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T12:00:00Z`))) {
    throw new ValidationError(`Expected an ISO date (YYYY-MM-DD), got ${String(value)}`);
  }
  return value;
}

export interface ValidReceiptLine {
  itemId: string;
  priceCents: number;
  quantity: number;
}

export function assertReceiptLines(value: unknown): ValidReceiptLine[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError('A receipt needs at least one line');
  }
  return value.map((entry) => {
    const line = entry as Record<string, unknown>;
    const quantity = assertQuantity(line.quantity);
    if (quantity < 1) throw new ValidationError('A receipt line needs a quantity of at least 1');
    return {
      itemId: assertItemId(line.itemId),
      priceCents: assertPriceCents(line.priceCents),
      quantity,
    };
  });
}
