import type { Chain, Store } from '@/core/domain';

/**
 * Salt Lake Valley store set.
 *
 * Only the Kroger chain has an official public price API, so it is the only
 * chain with provider 'kroger'. Everything else is seeded and badged as such —
 * see ADR 0003. Smith's is a *banner* of Kroger, which is why one credential
 * prices it.
 */
export const CHAINS: Chain[] = [
  { id: 'kroger', name: 'Kroger', ownBrand: 'Kroger', provider: 'kroger' },
  { id: 'winco', name: 'WinCo Foods', ownBrand: 'WinCo Foods', provider: 'seed' },
  { id: 'walmart', name: 'Walmart', ownBrand: 'Great Value', provider: 'seed' },
  { id: 'costco', name: 'Costco', ownBrand: 'Kirkland Signature', provider: 'seed' },
  { id: 'target', name: 'Target', ownBrand: 'Good & Gather', provider: 'seed' },
  { id: 'harmons', name: 'Harmons', ownBrand: 'Harmons', provider: 'seed' },
  { id: 'sprouts', name: 'Sprouts', ownBrand: 'Sprouts', provider: 'seed' },
  { id: 'traderjoes', name: "Trader Joe's", ownBrand: "Trader Joe's", provider: 'seed' },
];

export const STORES: Store[] = [
  {
    id: 'smiths-900e',
    chainId: 'kroger',
    banner: "Smith's",
    label: "Smith's — 900 E",
    address: '876 E 800 S, Salt Lake City, UT',
    krogerLocationId: '70300060',
    driveMinutes: 7,
  },
  {
    id: 'winco-redwood',
    chainId: 'winco',
    banner: 'WinCo Foods',
    label: 'WinCo — Redwood Rd',
    address: '1717 S Redwood Rd, Salt Lake City, UT',
    driveMinutes: 14,
  },
  {
    id: 'walmart-3300s',
    chainId: 'walmart',
    banner: 'Walmart',
    label: 'Walmart — 3300 S',
    address: '3555 S 900 E, Millcreek, UT',
    driveMinutes: 12,
  },
  {
    id: 'costco-sandy',
    chainId: 'costco',
    banner: 'Costco',
    label: 'Costco — Sandy',
    address: '11100 S Auto Mall Dr, Sandy, UT',
    driveMinutes: 25,
  },
  {
    id: 'target-sugarhouse',
    chainId: 'target',
    banner: 'Target',
    label: 'Target — Sugar House',
    // Address and store id confirmed against Target's own nearby_stores API.
    address: '2236 S 1300 E, Salt Lake City, UT',
    targetStoreId: '3365',
    driveMinutes: 8,
  },
  {
    id: 'harmons-brickyard',
    chainId: 'harmons',
    banner: 'Harmons',
    label: 'Harmons — Brickyard',
    address: '3200 S 1300 E, Salt Lake City, UT',
    driveMinutes: 9,
  },
  {
    id: 'sprouts-sugarhouse',
    chainId: 'sprouts',
    banner: 'Sprouts',
    label: 'Sprouts — Sugar House',
    address: '1206 E 2100 S, Salt Lake City, UT',
    driveMinutes: 8,
  },
  {
    id: 'tj-sugarhouse',
    chainId: 'traderjoes',
    banner: "Trader Joe's",
    label: "Trader Joe's — Sugar House",
    address: '2148 Highland Dr, Salt Lake City, UT',
    driveMinutes: 8,
  },
];

/** Stores selected by default on first run. The comparison universe is a hard filter. */
export const DEFAULT_SELECTED_STORE_IDS = [
  'smiths-900e',
  'winco-redwood',
  'harmons-brickyard',
  'costco-sandy',
];

export const chainById = new Map(CHAINS.map((c) => [c.id, c]));
export const storeById = new Map(STORES.map((s) => [s.id, s]));

export function chainForStore(storeId: string): Chain {
  const store = storeById.get(storeId);
  if (!store) throw new Error(`Unknown store: ${storeId}`);
  const chain = chainById.get(store.chainId);
  if (!chain) throw new Error(`Unknown chain: ${store.chainId}`);
  return chain;
}
