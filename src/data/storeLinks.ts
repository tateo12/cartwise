/**
 * Per-chain search deep links.
 *
 * This is the one price route that works for EVERY store, including the ones no
 * API or scraper can reach. It does not fetch anything: it builds the URL you
 * would have typed, so one tap lands you on that retailer's own page with the
 * item searched. You see their real current price, on their site, with their
 * promotions applied.
 *
 * Walmart and Costco are here specifically because their bot protection makes
 * automated reads impossible. A link sidesteps that entirely: your browser is a
 * welcome visitor even when a script is not.
 */

export interface StoreLink {
  /** Where the search happens, for the label. */
  label: string;
  /** Builds the search URL for a query. */
  url: (query: string) => string;
  /**
   * The store's own shopping landing page, for "order this whole list".
   * A search URL cannot represent a list, so these are separate links.
   */
  home: string;
  /**
   * True when the destination is an Instacart-powered storefront, so the price
   * shown may include Instacart markup rather than being the shelf price.
   */
  instacart?: boolean;
}

function encode(query: string): string {
  return encodeURIComponent(query.trim());
}

/**
 * Keyed by chain id from `src/data/stores.ts`.
 *
 * Verified reachable in a browser as of August 2026. These are ordinary public
 * search pages, not internal endpoints.
 */
export const STORE_LINKS: Record<string, StoreLink> = {
  kroger: {
    label: "Smith's",
    home: 'https://www.smithsfoodanddrug.com/',
    url: (q) => `https://www.smithsfoodanddrug.com/search?query=${encode(q)}&searchType=default_search`,
  },
  walmart: {
    label: 'Walmart',
    home: 'https://www.walmart.com/cp/food/976759',
    url: (q) => `https://www.walmart.com/search?q=${encode(q)}`,
  },
  target: {
    label: 'Target',
    home: 'https://www.target.com/c/grocery/-/N-5xt1a',
    url: (q) => `https://www.target.com/s?searchTerm=${encode(q)}`,
  },
  costco: {
    label: 'Costco',
    home: 'https://www.costco.com/grocery-household.html',
    url: (q) => `https://www.costco.com/CatalogSearch?dept=All&keyword=${encode(q)}`,
  },
  harmons: {
    label: 'Harmons',
    home: 'https://shop.harmonsgrocery.com/store/harmons/storefront',
    url: (q) => `https://shop.harmonsgrocery.com/store/harmons/s?k=${encode(q)}`,
    instacart: true,
  },
  sprouts: {
    label: 'Sprouts',
    home: 'https://shop.sprouts.com/store/sprouts/storefront',
    url: (q) => `https://shop.sprouts.com/store/sprouts/s?k=${encode(q)}`,
    instacart: true,
  },
  winco: {
    // WinCo publishes no prices of its own anywhere, and shop.wincofoods.com
    // does not resolve. Instacart is the only online route, and it marks
    // non-partner retailers up, so this is not a shelf price.
    label: 'WinCo (Instacart)',
    home: 'https://www.instacart.com/store/winco-foods/storefront',
    url: (q) => `https://www.instacart.com/store/winco-foods/s?k=${encode(q)}`,
    instacart: true,
  },
  traderjoes: {
    // Trader Joe's lists products but not prices. The link is still useful for
    // confirming they carry it; the price has to come off your receipt.
    label: "Trader Joe's",
    home: 'https://www.traderjoes.com/home/products',
    url: (q) => `https://www.traderjoes.com/home/search?q=${encode(q)}&section=products`,
  },
};

export function storeLinkFor(chainId: string): StoreLink | null {
  return STORE_LINKS[chainId] ?? null;
}

/** Every chain we can link to, for a "check everywhere" row. */
export function allStoreLinks(): (StoreLink & { chainId: string })[] {
  return Object.entries(STORE_LINKS).map(([chainId, link]) => ({ chainId, ...link }));
}
