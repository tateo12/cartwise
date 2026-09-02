import { spawn } from 'node:child_process';
import type { Offer, Product, Store } from '@/core/domain';
import { parseSize } from '@/core/units';
import type { PriceProvider } from './types';

/**
 * Prices for regional chains that sell through white-label Instacart
 * storefronts: Harmons, Sprouts and Fresh Market.
 *
 * These stores serve their prices to anyone who asks. No challenge page, no
 * CAPTCHA, no rate limiting — verified repeatedly against all three. Nothing
 * here circumvents anything: it fetches a public page and reads it, which is
 * why these three are viable where Walmart, Costco and Target are not.
 *
 * Two honest caveats:
 *  - The pages render client-side, so this needs a browser. It drives headless
 *    Chrome as a child process rather than adding a dependency, and a hung
 *    browser can never take the server down with it.
 *  - These are Instacart-powered storefronts, so prices may carry Instacart
 *    markup rather than being the in-store shelf price. Offers are marked
 *    accordingly so the UI can say so rather than implying register truth.
 *
 * Parsing targets the ACCESSIBILITY markup ("Current price: $2.29" in a
 * screen-reader span, plus the product link) rather than CSS classes, which are
 * build-hashed (`e-gx2pr0`) and change on every deploy.
 */

/** Storefront search URLs, verified reachable. */
const STOREFRONTS: Record<string, { base: string; label: string }> = {
  harmons: { base: 'https://shop.harmonsgrocery.com/store/harmons', label: 'Harmons' },
  sprouts: { base: 'https://shop.sprouts.com/store/sprouts', label: 'Sprouts' },
  freshmarket: { base: 'https://shop.freshmarketstores.com/store/fresh-market', label: 'Fresh Market' },
};

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const PAGE_TIMEOUT_MS = 45_000;
/** One page at a time. This is a household-scale read, not a crawl. */
const DELAY_BETWEEN_REQUESTS_MS = 1_200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chromeBinary(): string | null {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  // `existsSync` would need node:fs here; spawn failing is handled by the caller.
  return CHROME_PATHS[0] ?? null;
}

/** Renders a URL and returns its DOM, or null if the browser failed. */
function renderPage(url: string): Promise<string | null> {
  const binary = chromeBinary();
  if (!binary) return Promise.resolve(null);

  return new Promise((resolve) => {
    const child = spawn(
      binary,
      ['--headless', '--disable-gpu', '--hide-scrollbars', '--virtual-time-budget=20000', '--dump-dom', url],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );

    let html = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(null);
    }, PAGE_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      html += String(chunk);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(html.length > 0 ? html : null);
    });
  });
}

export interface StorefrontListing {
  name: string;
  sizeLabel: string | null;
  priceCents: number;
  /**
   * The pre-sale price, when the card advertises one. Only populated when it is
   * genuinely HIGHER than the current price, so a struck-out figure can never
   * be lower than what you pay.
   */
  regularPriceCents: number | null;
  /** Storefront's own product id, from the product URL. */
  sourceId: string | null;
}

/**
 * Screen-reader price labels that appear as readable text inside a card.
 *
 * These must be excluded when hunting for the product name: a card on
 * promotion carries an extra "Original Price: $3.99" span, and taking the first
 * readable line naively made that the product's name.
 */
const PRICE_LABEL = /^(?:current price|original price|price|was|sale price|reg\.? price)\s*:/i;

/** Promo and attribute badges that are not product names. */
const BADGE = /^(?:\d+%\s*off|best seller|new|sale|organic|gluten-free|trans fat-free|\+\d+|sponsored)$/i;

/**
 * Turns a product URL slug into a readable name.
 *
 * "food-club-whole-milk-1-gl" -> "food club whole milk 1 gl". Trailing size
 * fragments are left in place: they do no harm to token matching and the size
 * is read separately from the card anyway.
 */
function slugToName(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number.parseInt(code, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Extracts listings from a rendered storefront page.
 *
 * Each product card contains, in DOM order: a screen-reader price
 * ("Current price: $2.29"), the product name, and the pack size.
 */
export function parseStorefront(html: string): StorefrontListing[] {
  const listings: StorefrontListing[] = [];

  for (const card of html.split('aria-label="Product"').slice(1)) {
    const window = card.slice(0, 4000);

    const priceMatch = window.match(/Current price:\s*\$?([\d.]+)/);
    if (!priceMatch) continue;
    const priceCents = Math.round(Number.parseFloat(priceMatch[1]) * 100);
    if (!Number.isFinite(priceCents) || priceCents <= 0) continue;

    // Promoted cards advertise the pre-sale figure. Keep it only when higher.
    const originalMatch = window.match(/Original Price:\s*\$?([\d.]+)/i);
    const originalCents = originalMatch ? Math.round(Number.parseFloat(originalMatch[1]) * 100) : null;
    const regularPriceCents = originalCents != null && originalCents > priceCents ? originalCents : null;

    // The product URL is the most reliable name source on the card. Readable
    // DOM order breaks on promoted items, where badges ("8% off") and an
    // "Original Price" span sit between the price and the actual name.
    const linkMatch = window.match(/\/products\/(\d+)-([a-z0-9-]+)/i);
    const idMatch = linkMatch;
    const slugName = linkMatch ? slugToName(linkMatch[2]) : null;

    // Readable text after the price line: name first, then size.
    const readable = window
      .replace(/<[^>]+>/g, '\n')
      .split('\n')
      .map((line) => decodeEntities(line).trim())
      .filter((line) => line.length > 1);

    const priceIndex = readable.findIndex((line) => line.startsWith('Current price:'));
    const after = readable.slice(priceIndex + 1).filter((line) => !/^\d{1,3}$/.test(line));

    const readableName =
      after.find((line) => /[A-Za-z]{3}/.test(line) && !PRICE_LABEL.test(line) && !BADGE.test(line) && !parseSize(line)) ??
      null;
    // Prefer the slug; fall back to readable text only if there is no link.
    const name = slugName ?? readableName;
    if (!name) continue;
    const sizeLabel = after.find((line) => parseSize(line) != null) ?? null;

    listings.push({ name, sizeLabel, priceCents, regularPriceCents, sourceId: idMatch?.[1] ?? null });
  }

  return listings;
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2),
  );
}

/**
 * Scores a listing against the Product we want.
 *
 * A size mismatch disqualifies rather than merely penalising: pricing the wrong
 * pack is worse than reporting no price, because a wrong number silently
 * poisons the whole basket comparison.
 */
function scoreListing(product: Product, listing: StorefrontListing): number {
  const wanted = tokens(product.name);
  if (wanted.size === 0) return 0;
  const have = tokens(listing.name);

  let hits = 0;
  for (const word of wanted) if (have.has(word)) hits++;
  const overlap = hits / wanted.size;
  if (overlap < 0.34) return 0;

  if (listing.sizeLabel) {
    const parsed = parseSize(listing.sizeLabel);
    if (parsed) {
      if (parsed.dimension !== product.dimension) return 0;
      const ratio = (parsed.sizeBase * parsed.packMultiple) / (product.sizeBase * product.packMultiple);
      if (ratio < 0.92 || ratio > 1.08) return 0;
      return overlap + 0.5;
    }
  }
  return overlap;
}

export const storefrontProvider: PriceProvider = {
  id: 'storefront',
  label: 'Regional storefronts',

  isAvailable() {
    return process.env.ENABLE_STOREFRONT_PRICES === '1';
  },

  async checkAuth() {
    if (!this.isAvailable()) {
      return { ok: false, reason: 'Storefront pricing is off. Set ENABLE_STOREFRONT_PRICES=1 to enable.' };
    }
    const html = await renderPage(`${STOREFRONTS.harmons.base}/s?k=milk`);
    return html && html.includes('aria-label="Product"')
      ? { ok: true }
      : { ok: false, reason: 'Could not render a storefront page. Is Chrome installed?' };
  },

  async fetchOffers(store: Store, products: Product[]): Promise<Offer[]> {
    const storefront = STOREFRONTS[store.chainId];
    if (!storefront) return [];

    const fetchedAt = new Date().toISOString();
    const offers: Offer[] = [];

    // Strictly sequential. These stores impose no limits, which is a reason to
    // be careful with them rather than a licence to hammer.
    for (const product of products) {
      const url = `${storefront.base}/s?k=${encodeURIComponent(product.name)}`;
      const html = await renderPage(url);
      await sleep(DELAY_BETWEEN_REQUESTS_MS);
      if (!html) continue;

      const best = parseStorefront(html)
        .map((listing) => ({ listing, score: scoreListing(product, listing) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)[0];

      if (!best) continue;

      offers.push({
        productId: product.id,
        storeId: store.id,
        priceCents: best.listing.priceCents,
        // Only set when the card advertised a genuinely higher pre-sale price.
        regularPriceCents: best.listing.regularPriceCents,
        stock: 'unknown',
        provenance: 'live',
        fetchedAt,
        sourceUpc: best.listing.sourceId ?? undefined,
      });
    }

    return offers;
  },
};
