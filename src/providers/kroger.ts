import type { Offer, Product, StockLevel, Store } from '@/core/domain';
import type { PriceProvider } from './types';

/**
 * Kroger Products API — the one genuinely official, free, public price source
 * in this app. Prices Smith's, King Soopers, Fred Meyer, Ralphs, QFC, Fry's,
 * Dillons and Harris Teeter from a single credential.
 *
 * Docs: https://developer.kroger.com/api-products/api/product-api-public
 * Auth: OAuth2 client_credentials, scope `product.compact`.
 *
 * Rate limits are real (per-endpoint daily caps), so this provider batches by
 * search term and caches its token until expiry.
 */

const TOKEN_URL = 'https://api.kroger.com/v1/connect/oauth2/token';
const PRODUCTS_URL = 'https://api.kroger.com/v1/products';

/** Hard ceiling per request. Without it a hung socket stalls a whole refresh. */
const REQUEST_TIMEOUT_MS = 8_000;
/** Kroger enforces per-endpoint daily caps; stay polite and predictable. */
const MAX_CONCURRENT_REQUESTS = 4;

/**
 * Kroger returns 13-digit GTINs (e.g. `0001111041700`) while our catalog stores
 * 12-digit UPC-A (e.g. `081268001078`). A raw `===` therefore NEVER matches,
 * which would silently turn every name-brand item into "not carried" and
 * manufacture forced stops out of a formatting mismatch. Compare on a
 * zero-padded 13-digit normal form.
 */
export function normalizeUpc(raw: string): string {
  return raw.replace(/\D/g, '').padStart(13, '0');
}

function upcMatches(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return normalizeUpc(a) === normalizeUpc(b);
}

/** Runs `task` over `items` with at most `limit` in flight at once. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  // Assigned by index rather than pre-allocated, so every slot is filled by
  // exactly one worker and the result order matches the input order.
  const results: R[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

interface CachedToken {
  token: string;
  /** Epoch ms. */
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

interface KrogerItem {
  price?: { regular?: number; promo?: number };
  size?: string;
  inventory?: { stockLevel?: string };
}

interface KrogerProduct {
  productId: string;
  upc: string;
  brand?: string;
  description: string;
  items?: KrogerItem[];
}

function credentials(): { id: string; secret: string } | null {
  const id = process.env.KROGER_CLIENT_ID;
  const secret = process.env.KROGER_CLIENT_SECRET;
  if (!id || !secret) return null;
  return { id, secret };
}

type TokenResult = { ok: true; token: string } | { ok: false; reason: string };

/**
 * Obtains an access token, reporting WHY it failed.
 *
 * The reason matters: previously a 401 from bad credentials collapsed into
 * `null`, so a refresh reported "0 updated, 60 kept seeded" with no error and
 * looked indistinguishable from "Kroger simply had no matching products".
 */
async function requestToken(): Promise<TokenResult> {
  const creds = credentials();
  if (!creds) return { ok: false, reason: 'Kroger credentials are not configured.' };

  // Refresh a minute early rather than racing the expiry boundary.
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return { ok: true, token: cachedToken.token };

  const basic = Buffer.from(`${creds.id}:${creds.secret}`).toString('base64');

  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials&scope=product.compact',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = response.status === 401 ? 'credentials rejected (401)' : `${response.status} ${response.statusText}`;
      return { ok: false, reason: `Kroger auth failed: ${detail}` };
    }

    const json = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return { ok: false, reason: 'Kroger auth returned no access token.' };

    cachedToken = {
      token: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 1800) * 1000,
    };
    return { ok: true, token: cachedToken.token };
  } catch (error) {
    return { ok: false, reason: `Kroger auth errored: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function mapStockLevel(raw: string | undefined): StockLevel {
  switch (raw) {
    case 'HIGH':
      return 'high';
    case 'LOW':
      return 'low';
    case 'TEMPORARILY_OUT_OF_STOCK':
    case 'OUT_OF_STOCK':
      return 'out_of_stock';
    default:
      return 'unknown';
  }
}

/** Dollars (Kroger's unit) to integer cents, without float drift. */
function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/**
 * Searches one term at one location. Kroger's search is a term match, not a
 * UPC lookup, so results need filtering by the caller.
 */
async function search(
  token: string,
  locationId: string,
  filter: { term: string } | { productId: string },
): Promise<KrogerProduct[]> {
  const url = new URL(PRODUCTS_URL);
  // A UPC is an exact lookup via filter.productId; filter.term is a text
  // search and will not reliably find a product by its barcode.
  if ('productId' in filter) url.searchParams.set('filter.productId', filter.productId);
  else url.searchParams.set('filter.term', filter.term);
  url.searchParams.set('filter.locationId', locationId);
  url.searchParams.set('filter.limit', '20');

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.warn(`[kroger] product search failed: ${response.status} ${url.search}`);
      return [];
    }

    const json = (await response.json()) as { data?: KrogerProduct[] };
    return json.data ?? [];
  } catch (error) {
    // A timeout or network failure must yield NO offer, never a guessed one.
    console.warn(`[kroger] product search errored: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/** Normalizes text for loose comparison: lowercase, alphanumeric words only. */
function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

/** Fraction of the Product's descriptive tokens present in the candidate. */
function overlapScore(product: Product, candidate: KrogerProduct): number {
  const wanted = tokens(product.name);
  if (wanted.size === 0) return 0;
  const have = tokens(`${candidate.brand ?? ''} ${candidate.description}`);
  let hits = 0;
  for (const word of wanted) if (have.has(word)) hits++;
  return hits / wanted.size;
}

export const krogerProvider: PriceProvider = {
  id: 'kroger',
  label: 'Kroger API (live)',

  isAvailable() {
    return credentials() != null;
  },

  /** Verifies credentials actually work, so a caller can report a real reason. */
  async checkAuth(): Promise<{ ok: boolean; reason?: string }> {
    const result = await requestToken();
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  },

  async fetchOffers(store: Store, products: Product[]): Promise<Offer[]> {
    if (!store.krogerLocationId) return [];
    const locationId = store.krogerLocationId;
    const auth = await requestToken();
    if (!auth.ok) {
      console.warn(`[kroger] ${auth.reason}`);
      return [];
    }
    const token = auth.token;

    const fetchedAt = new Date().toISOString();

    const resolved = await mapWithConcurrency(products, MAX_CONCURRENT_REQUESTS, async (product) => {
      const candidates = product.upc
        ? await search(token, locationId, { productId: normalizeUpc(product.upc) })
        : await search(token, locationId, { term: product.name });
      if (candidates.length === 0) return null;

      const match = product.upc
        ? candidates.find((candidate) => upcMatches(candidate.upc, product.upc))
        : candidates
            .map((candidate) => ({ candidate, score: overlapScore(product, candidate) }))
            .filter((entry) => entry.score >= 0.5)
            .sort((a, b) => b.score - a.score)[0]?.candidate;

      const priced = match?.items?.find((item) => item.price?.regular != null);
      if (!match || !priced?.price?.regular) return null;

      const regular = toCents(priced.price.regular);
      const promo = priced.price.promo ? toCents(priced.price.promo) : 0;
      // Kroger sends promo: 0 when there is no promotion.
      const onPromo = promo > 0 && promo < regular;

      const offer: Offer = {
        productId: product.id,
        storeId: store.id,
        priceCents: onPromo ? promo : regular,
        regularPriceCents: onPromo ? regular : null,
        stock: mapStockLevel(priced.inventory?.stockLevel),
        provenance: 'live',
        fetchedAt,
        // Kroger's own barcode for the matched product. Without this, cart push
        // has nothing to send.
        sourceUpc: match.upc,
      };
      return offer;
    });

    return resolved.filter((offer): offer is Offer => offer != null);
  },
};
