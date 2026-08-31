import type { Chain, MatchConfidence, Offer, Product, StockLevel, Store } from './domain';
import { parseSize } from './units';
import { CHAINS, STORES } from '@/data/stores';
import { ITEMS, type ItemSpec } from '@/data/items';

/**
 * Deterministic seeded pricing.
 *
 * Everything here is a pure function of (itemId, chainId, dayIndex) — no
 * Math.random, no Date.now. That means the seeded catalog is byte-identical on
 * every machine and every reseed, so a price you saw yesterday is the same
 * price today, and price history is reproducible rather than invented anew.
 */

/**
 * Per-chain price posture, as a multiplier on the Kroger baseline UNIT price.
 * Applied per base unit, which is why Costco lands expensive per pack and cheap
 * per ounce without needing a special case.
 */
const CHAIN_MULTIPLIER: Record<string, number> = {
  kroger: 1.0,
  winco: 0.86,
  walmart: 0.9,
  costco: 0.83,
  target: 1.06,
  harmons: 1.18,
  sprouts: 1.12,
  traderjoes: 1.02,
};

/** xmur3 + mulberry32: a tiny deterministic PRNG keyed by string. */
function hashSeed(key: string): number {
  let h = 1779033703 ^ key.length;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function rand01(key: string): number {
  let a = hashSeed(key);
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Signed jitter in [-magnitude, +magnitude]. */
function jitter(key: string, magnitude: number): number {
  return (rand01(key) * 2 - 1) * magnitude;
}

export interface CatalogEntry {
  item: ItemSpec;
  products: Product[];
}

function carriesItem(chain: Chain, item: ItemSpec): boolean {
  if (item.notCarried?.includes(chain.id)) return false;
  // Costco and Trader Joe's are opt-in: narrow real-world SKU ranges.
  if (chain.id === 'costco') return item.costco != null;
  if (chain.id === 'traderjoes') return item.tj === true;
  return true;
}

function sizeLabelFor(chain: Chain, item: ItemSpec): string {
  if (chain.id === 'costco' && item.costco) return item.costco.sizeLabel;
  return item.sizeLabel;
}

function brandFor(chain: Chain, item: ItemSpec): string {
  // A name-brand Item is the identical product everywhere, which is precisely
  // what earns a `high` confidence match. Store brands cannot.
  return item.nameBrand?.brand ?? chain.ownBrand;
}

function confidenceFor(item: ItemSpec): MatchConfidence {
  return item.nameBrand ? 'high' : 'medium';
}

/** Builds every Product in the catalog. Pure and stable across runs. */
export function buildProducts(): Product[] {
  const products: Product[] = [];
  for (const item of ITEMS) {
    for (const chain of CHAINS) {
      if (!carriesItem(chain, item)) continue;
      const sizeLabel = sizeLabelFor(chain, item);
      const parsed = parseSize(sizeLabel);
      if (!parsed) throw new Error(`Unparseable size "${sizeLabel}" for ${item.id}/${chain.id}`);
      if (parsed.dimension !== item.dimension) {
        throw new Error(
          `Dimension mismatch for ${item.id}/${chain.id}: size "${sizeLabel}" is ${parsed.dimension}, Item is ${item.dimension}`,
        );
      }
      products.push({
        id: `${item.id}__${chain.id}`,
        itemId: item.id,
        chainId: chain.id,
        brand: brandFor(chain, item),
        name: `${brandFor(chain, item)} ${item.name}`,
        sizeLabel,
        sizeBase: parsed.sizeBase,
        dimension: parsed.dimension,
        packMultiple: parsed.packMultiple,
        upc: item.nameBrand?.upc,
        confidence: confidenceFor(item),
      });
    }
  }
  return products;
}

/** Baseline cents per base unit, derived from the Item's reference pack. */
function baselineUnitCents(item: ItemSpec): number {
  const parsed = parseSize(item.sizeLabel);
  if (!parsed) throw new Error(`Unparseable reference size for ${item.id}`);
  return item.baseCents / (parsed.sizeBase * parsed.packMultiple);
}

/**
 * The regular (non-promo) price of a Product at a Store on a given day index,
 * where day 0 is today and positive values go back in time.
 *
 * A slow seasonal drift plus per-store jitter keeps history realistic without
 * being noisy enough to make the "is this a real low" question meaningless.
 */
export function regularPriceCents(product: Product, store: Store, dayIndex: number): number {
  const item = ITEMS.find((i) => i.id === product.itemId);
  if (!item) throw new Error(`Unknown item ${product.itemId}`);

  const unit = baselineUnitCents(item);
  const chainMult = CHAIN_MULTIPLIER[product.chainId] ?? 1;
  const storeJitter = 1 + jitter(`${product.id}:${store.id}`, 0.05);
  const totalBase = product.sizeBase * product.packMultiple;

  // Gentle inflation going forward in time (older days slightly cheaper) plus a
  // smooth seasonal wobble unique to each product.
  const inflation = 1 - dayIndex * 0.00035;
  const phase = rand01(`${product.id}:phase`) * Math.PI * 2;
  const seasonal = 1 + Math.sin(phase + dayIndex / 22) * 0.035;

  const cents = unit * totalBase * chainMult * storeJitter * inflation * seasonal;
  return roundToRetailPrice(cents);
}

/**
 * Snaps to a believable shelf price. Grocery prices cluster on .99/.49/.29
 * endings, and rounding to plain cents makes seeded data look synthetic.
 */
function roundToRetailPrice(cents: number): number {
  if (cents < 100) return Math.max(25, Math.round(cents));
  const dollars = Math.floor(cents / 100);
  const remainder = cents - dollars * 100;
  const endings = [9, 19, 29, 39, 49, 59, 69, 79, 89, 99];
  let best = endings[0];
  for (const e of endings) {
    if (Math.abs(e - remainder) < Math.abs(best - remainder)) best = e;
  }
  return dollars * 100 + best;
}

export type PromoKind = 'none' | 'genuine' | 'fake';

export interface PromoState {
  kind: PromoKind;
}

/**
 * Whether a Product is on promo at a Store on a given day.
 *
 * Promos run in ~10-day windows. Roughly a fifth are deliberately **fake**,
 * because catching those is a feature and seeded data containing none would
 * make the detector untestable.
 */
export function promoState(product: Product, store: Store, dayIndex: number): PromoState {
  const window = Math.floor(dayIndex / 10);
  if (rand01(`${product.id}:${store.id}:promo:${window}`) > 0.22) return { kind: 'none' };
  const fake = rand01(`${product.id}:${store.id}:fake:${window}`) < 0.22;
  return { kind: fake ? 'fake' : 'genuine' };
}

/**
 * Shelf price actually charged on a day, plus the "was" price on the tag.
 *
 * A **genuine** promo discounts the real price, so `regularPriceCents` is the
 * true former price and is genuinely higher.
 *
 * A **fake** sale is how retailers actually do it: the shelf price stays at
 * roughly the normal level while the advertised "was" figure is inflated. That
 * is why `regularPriceCents` must always be ABOVE `priceCents` — a struck-out
 * price lower than what you pay is meaningless, and modelling it the other way
 * round produced exactly that nonsense in the UI.
 */
export function shelfPriceCents(
  product: Product,
  store: Store,
  dayIndex: number,
): { priceCents: number; regularPriceCents: number | null } {
  const regular = regularPriceCents(product, store, dayIndex);
  const promo = promoState(product, store, dayIndex);
  const window = Math.floor(dayIndex / 10);

  if (promo.kind === 'none') return { priceCents: regular, regularPriceCents: null };

  if (promo.kind === 'fake') {
    // Sold at ~the normal price; the tag's reference figure is padded 10-18%.
    const drift = 0.99 + rand01(`${product.id}:${store.id}:fk:${window}`) * 0.02;
    const padding = 1.1 + rand01(`${product.id}:${store.id}:pad:${window}`) * 0.08;
    const price = roundToRetailPrice(regular * drift);
    const was = roundToRetailPrice(regular * padding);
    // Guarantee the invariant even after retail-price snapping.
    return { priceCents: price, regularPriceCents: Math.max(was, price + 10) };
  }

  const discount = 0.78 + rand01(`${product.id}:${store.id}:dc:${window}`) * 0.14;
  const price = roundToRetailPrice(regular * discount);
  return { priceCents: price, regularPriceCents: Math.max(regular, price + 10) };
}

/**
 * Stock level for a SEEDED offer.
 *
 * Always `unknown`. A seeded provider genuinely cannot know availability, and
 * inventing it is the same class of lie as inventing a price — worse, actually:
 * a fabricated `out_of_stock` removes the Item from that store's plan and
 * manufactures a forced extra stop out of nothing.
 *
 * Real stock levels arrive only from a live provider response (see
 * `providers/kroger.ts`, which maps Kroger's `inventory.stockLevel`).
 */
export function stockFor(_product: Product, _store: Store): StockLevel {
  return 'unknown';
}

/** Builds today's Offers for every Product at every Store of its chain. */
export function buildOffers(products: Product[], isoNow: string): Offer[] {
  const offers: Offer[] = [];
  for (const store of STORES) {
    for (const product of products) {
      if (product.chainId !== store.chainId) continue;
      const { priceCents, regularPriceCents: reg } = shelfPriceCents(product, store, 0);
      offers.push({
        productId: product.id,
        storeId: store.id,
        priceCents,
        regularPriceCents: reg,
        stock: stockFor(product, store),
        provenance: 'seed',
        fetchedAt: isoNow,
      });
    }
  }
  return offers;
}
