import { describe, expect, test } from 'bun:test';
import { parseSize, unitPriceCents } from '../units';
import { analyzeDeal, VERDICT_LABEL, VERDICT_TONE, type DealVerdict, type PricePoint } from '../history';
import { anchoredPlan, bestAcrossStores, optimize, offerKey, type OfferIndex } from '../optimizer';
import type { BasketLine, Offer, Product, Store } from '../domain';
import { buildProducts, buildOffers, promoState, regularPriceCents, shelfPriceCents } from '../pricing';
import { STORES } from '../../data/stores';
import { ITEMS } from '../../data/items';
import { krogerProvider } from '../../providers/kroger';
import { parseReceipt, reconcile } from '../receiptParser';

describe('parseSize', () => {
  test('parses plain sizes into base units', () => {
    expect(parseSize('1 gal')).toEqual({ sizeBase: 128, packMultiple: 1, dimension: 'volume' });
    expect(parseSize('3 lb')).toEqual({ sizeBase: 48, packMultiple: 1, dimension: 'mass' });
    expect(parseSize('18 ct')).toEqual({ sizeBase: 18, packMultiple: 1, dimension: 'count' });
  });

  test('parses pack multiples without folding them into size', () => {
    expect(parseSize('2 x 1 gal')).toEqual({ sizeBase: 128, packMultiple: 2, dimension: 'volume' });
    expect(parseSize('12 x 12 fl oz')).toEqual({ sizeBase: 12, packMultiple: 12, dimension: 'volume' });
  });

  test('never confuses fluid ounces with weight ounces', () => {
    expect(parseSize('8 fl oz')?.dimension).toBe('volume');
    expect(parseSize('8 oz')?.dimension).toBe('mass');
  });

  test('returns null rather than guessing on unparseable labels', () => {
    expect(parseSize('family size')).toBeNull();
    expect(parseSize('')).toBeNull();
  });
});

describe('unitPriceCents', () => {
  test('applies pack multiple so bulk is compared honestly', () => {
    // Costco 2 x 1 gal at $5.49 is cheaper per gallon than 1 gal at $2.98.
    const costco = unitPriceCents(549, 128, 2)!;
    const winco = unitPriceCents(298, 128, 1)!;
    expect(costco).toBeLessThan(winco);
    expect(costco * 128).toBeCloseTo(274.5, 1);
  });

  test('guards against divide-by-zero instead of returning Infinity', () => {
    expect(unitPriceCents(500, 0, 1)).toBeNull();
  });
});

describe('every catalog size label is parseable and dimensionally consistent', () => {
  test('buildProducts does not throw', () => {
    const products = buildProducts();
    expect(products.length).toBeGreaterThan(200);
    for (const p of products) {
      expect(p.sizeBase).toBeGreaterThan(0);
      expect(p.packMultiple).toBeGreaterThanOrEqual(1);
    }
  });

  test('name-brand items match at high confidence, store brands at medium', () => {
    const products = buildProducts();
    const fairlife = products.filter((p) => p.itemId === 'fairlife-milk');
    const milk = products.filter((p) => p.itemId === 'whole-milk');
    expect(fairlife.every((p) => p.confidence === 'high')).toBe(true);
    expect(fairlife.every((p) => p.upc === '081268001078')).toBe(true);
    expect(milk.every((p) => p.confidence === 'medium')).toBe(true);
  });

  test('opt-in chains only carry what they opt into', () => {
    const products = buildProducts();
    const costcoIds = new Set(products.filter((p) => p.chainId === 'costco').map((p) => p.itemId));
    const expected = new Set(ITEMS.filter((i) => i.costco).map((i) => i.id));
    expect([...costcoIds].sort()).toEqual([...expected].sort());
  });
});

describe('pricing determinism', () => {
  test('the same product/store/day always yields the same price', () => {
    const products = buildProducts();
    const product = products.find((p) => p.itemId === 'whole-milk' && p.chainId === 'kroger')!;
    const store = STORES.find((s) => s.chainId === 'kroger')!;
    const a = regularPriceCents(product, store, 0);
    const b = regularPriceCents(product, store, 0);
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
  });

  test('prices land on believable retail endings', () => {
    const products = buildProducts();
    const store = STORES[0];
    const priced = products
      .filter((p) => p.chainId === store.chainId)
      .map((p) => regularPriceCents(p, store, 0))
      .filter((c) => c >= 100);
    const endings = new Set(priced.map((c) => c % 100));
    for (const e of endings) expect(e % 10).toBe(9);
  });
});

// ── Optimizer: hand-built fixture with known-correct answers ───────────────
function fixture() {
  const stores: Store[] = [
    { id: 'winco', chainId: 'c-winco', banner: 'WinCo', label: 'WinCo', address: '', driveMinutes: 14 },
    { id: 'smiths', chainId: 'c-kroger', banner: "Smith's", label: "Smith's", address: '', driveMinutes: 7 },
    { id: 'harmons', chainId: 'c-harmons', banner: 'Harmons', label: 'Harmons', address: '', driveMinutes: 9 },
  ];

  // milk + oil. WinCo does NOT carry oil — the forced-stop case.
  const rows: [string, string, string, number][] = [
    ['milk', 'c-winco', 'winco', 298],
    ['milk', 'c-kroger', 'smiths', 329],
    ['milk', 'c-harmons', 'harmons', 379],
    ['oil', 'c-kroger', 'smiths', 1299],
    ['oil', 'c-harmons', 'harmons', 999],
  ];

  const productsByItem = new Map<string, Product[]>();
  const offers = new Map<string, Offer>();
  for (const [itemId, chainId, storeId, cents] of rows) {
    const product: Product = {
      id: `${itemId}__${chainId}`,
      itemId,
      chainId,
      brand: 'x',
      name: itemId,
      sizeLabel: '1 ct',
      sizeBase: 1,
      dimension: 'count',
      packMultiple: 1,
      confidence: 'medium',
    };
    const list = productsByItem.get(itemId) ?? [];
    list.push(product);
    productsByItem.set(itemId, list);
    offers.set(offerKey(product.id, storeId), {
      productId: product.id,
      storeId,
      priceCents: cents,
      regularPriceCents: null,
      stock: 'unknown',
      provenance: 'seed',
      fetchedAt: '2026-01-01T00:00:00.000Z',
    });
  }

  const index: OfferIndex = { productsByItem, offers, storesById: new Map(stores.map((s) => [s.id, s])) };
  const basket: BasketLine[] = [
    { itemId: 'milk', quantity: 1 },
    { itemId: 'oil', quantity: 1 },
  ];
  return { index, basket, selected: ['winco', 'smiths', 'harmons'] };
}

describe('optimizer', () => {
  test('a store that does not carry an item is NOT rewarded with a smaller bill', () => {
    const { index, basket, selected } = fixture();
    const result = optimize(index, basket, selected);
    const winco = result.perStore.find((p) => p.storeId === 'winco')!;
    // Naive (buggy) behaviour would total 298. Correct behaviour sources the
    // oil from Harmons at 999, for a complete-basket total of 1297.
    expect(winco.plan.totalCents).toBe(1297);
    expect(winco.plan.assignments).toHaveLength(2);
  });

  test('the forced extra stop is labelled as forced', () => {
    const { index, basket, selected } = fixture();
    const result = optimize(index, basket, selected);
    const winco = result.perStore.find((p) => p.storeId === 'winco')!;
    expect(winco.plan.forcedStopIds).toEqual(['harmons']);
    const oil = winco.plan.assignments.find((a) => a.itemId === 'oil')!;
    expect(oil.forced).toBe(true);
    expect(oil.storeId).toBe('harmons');
  });

  test('winner is the cheapest ONE-STOP anchor; a cheaper multi-stop goes to the ladder', () => {
    const { index, basket, selected } = fixture();
    const result = optimize(index, basket, selected);

    // Anchored totals: winco 298+999=1297 but needs 2 stops (no oil at WinCo);
    // harmons 379+999=1378 in 1 stop; smiths 329+1299=1628 in 1 stop.
    // Stop count ranks before price (ADR 0002), so the headline is the cheapest
    // genuine single-store answer — Harmons — and WinCo's cheaper total is not
    // hidden, it moves to the ladder with its extra stop made explicit.
    expect(result.winner.anchorId).toBe('harmons');
    expect(result.winner.totalCents).toBe(1378);
    expect(result.winner.storeIds).toHaveLength(1);

    expect(result.runnerUp?.anchorId).toBe('smiths');

    expect(result.ladder).toHaveLength(1);
    expect(result.ladder[0].plan.totalCents).toBe(1297);
    expect(result.ladder[0].savingsCents).toBe(81);
    expect(result.ladder[0].stops).toBe(2);
    // The cheaper plan still buys everything.
    expect(result.ladder[0].plan.unavailableItemIds).toEqual([]);
  });

  test('selected store set is a hard filter', () => {
    const { index, basket } = fixture();
    const result = optimize(index, basket, ['smiths']);
    // Smith's alone: 329 + 1299. Harmons' cheaper oil is invisible.
    expect(result.winner.totalCents).toBe(1628);
    expect(result.winner.unavailableItemIds).toEqual([]);
  });

  test('items no selected store carries are reported, not silently dropped', () => {
    const { index, basket } = fixture();
    const result = optimize(index, basket, ['winco']);
    expect(result.winner.unavailableItemIds).toEqual(['oil']);
    expect(result.winner.totalCents).toBe(298);
  });

  test('quantity multiplies the pack price', () => {
    const { index, selected } = fixture();
    const result = optimize(index, [{ itemId: 'milk', quantity: 3 }], selected);
    expect(result.winner.totalCents).toBe(894);
  });

  test('ladder only contains plans that beat the winner', () => {
    const { index, basket, selected } = fixture();
    const result = optimize(index, basket, selected);
    for (const row of result.ladder) {
      expect(row.plan.totalCents).toBeLessThan(result.winner.totalCents);
      expect(row.savingsCents).toBeGreaterThan(0);
      expect(row.plan.storeIds.length).toBe(row.stops);
    }
  });

  test('search-bar best-across-stores respects the selection', () => {
    const { index } = fixture();
    expect(bestAcrossStores(index, 'oil', ['winco', 'smiths', 'harmons'])?.storeId).toBe('harmons');
    expect(bestAcrossStores(index, 'oil', ['smiths'])?.storeId).toBe('smiths');
    expect(bestAcrossStores(index, 'oil', ['winco'])).toBeNull();
  });

  test('empty selection degrades safely instead of throwing', () => {
    const { index, basket } = fixture();
    const result = optimize(index, basket, []);
    expect(result.winner.totalCents).toBe(0);
    expect(result.ladder).toEqual([]);
    expect(result.unavailableItemIds.sort()).toEqual(['milk', 'oil']);
  });
});

describe('deal detection', () => {
  const flat = (cents: number, days: number, onPromo = false, provenance: 'seed' | 'live' = 'seed'): PricePoint[] =>
    Array.from({ length: days }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      priceCents: cents,
      onPromo,
      provenance,
    }));

  test('calls out a sale tag priced at the normal price', () => {
    const history = flat(499, 60);
    expect(analyzeDeal(history, 499, true).verdict).toBe('fake-sale');
  });

  test('a genuine low is a real-low, not a fake sale', () => {
    const history = flat(499, 60);
    expect(analyzeDeal(history, 349, true).verdict).toBe('real-low');
  });

  test('refuses to make a claim without enough history', () => {
    expect(analyzeDeal(flat(499, 5), 199, false).verdict).toBe('typical');
  });

  test('a penny wobble on a flat staple is not a screaming deal', () => {
    const history = [...flat(499, 40), ...flat(498, 20)];
    expect(analyzeDeal(history, 498, false).verdict).not.toBe('real-low');
  });

  test('reports how far above the window low the current price is', () => {
    const history = [...flat(400, 30), ...flat(500, 30)];
    const signal = analyzeDeal(history, 500, false);
    expect(signal.lowCents).toBe(400);
    expect(signal.aboveLowCents).toBe(100);
    expect(signal.verdict).toBe('high');
  });
});

describe('seeded offers', () => {
  test('every offer is badged with its provenance', () => {
    const offers = buildOffers(buildProducts(), '2026-01-01T00:00:00.000Z');
    expect(offers.length).toBeGreaterThan(200);
    expect(offers.every((o) => o.provenance === 'seed')).toBe(true);
    expect(offers.every((o) => o.priceCents > 0)).toBe(true);
  });

  test('NO seeded offer ever reports a stock level, including Kroger-family', () => {
    // Was: kroger-chain seeded offers rolled a fake 4% out_of_stock / 10% low,
    // so a Seed-badged Smith's price could claim "low stock" and an invented
    // out_of_stock could manufacture a forced extra stop from nothing.
    const offers = buildOffers(buildProducts(), '2026-01-01T00:00:00.000Z');
    expect(offers.length).toBeGreaterThan(200);
    expect(offers.every((o) => o.provenance === 'seed')).toBe(true);
    expect(offers.every((o) => o.stock === 'unknown')).toBe(true);
  });
});

describe('promo price invariants', () => {
  test('a struck-out "was" price is NEVER below what you actually pay', () => {
    // The bug this guards: modelling a fake sale by inflating the SHELF price
    // produced a strikethrough lower than the current price, which reads as a
    // price rise dressed up as a saving.
    const products = buildProducts();
    let promoCount = 0;
    for (const store of STORES) {
      for (const product of products) {
        if (product.chainId !== store.chainId) continue;
        for (let day = 0; day < 90; day++) {
          const { priceCents, regularPriceCents } = shelfPriceCents(product, store, day);
          if (regularPriceCents == null) continue;
          promoCount++;
          expect(regularPriceCents).toBeGreaterThan(priceCents);
        }
      }
    }
    // Guard against the assertion passing because nothing was ever on promo.
    expect(promoCount).toBeGreaterThan(1000);
  });

  test('fake sales exist in the seeded data, so the detector is testable', () => {
    const products = buildProducts();
    const store = STORES.find((s) => s.chainId === 'winco')!;
    let fakes = 0;
    for (const product of products) {
      if (product.chainId !== store.chainId) continue;
      for (let day = 0; day < 90; day++) {
        if (promoState(product, store, day).kind === 'fake') fakes++;
      }
    }
    expect(fakes).toBeGreaterThan(0);
  });
});

describe('kroger provider degrades safely', () => {
  test('reports unavailable and returns no offers when credentials are absent', async () => {
    const savedId = process.env.KROGER_CLIENT_ID;
    const savedSecret = process.env.KROGER_CLIENT_SECRET;
    delete process.env.KROGER_CLIENT_ID;
    delete process.env.KROGER_CLIENT_SECRET;

    try {
      const store = STORES.find((s) => s.chainId === 'kroger')!;
      const products = buildProducts().filter((p) => p.chainId === 'kroger').slice(0, 3);

      expect(krogerProvider.isAvailable()).toBe(false);
      // Must return empty, NOT throw and NOT invent prices. An omitted offer
      // correctly reads as "not priceable"; a fabricated one would be a lie.
      await expect(krogerProvider.fetchOffers(store, products)).resolves.toEqual([]);
    } finally {
      if (savedId != null) process.env.KROGER_CLIENT_ID = savedId;
      if (savedSecret != null) process.env.KROGER_CLIENT_SECRET = savedSecret;
    }
  });

  test('returns no offers for a store with no kroger location id', async () => {
    const store = STORES.find((s) => s.chainId === 'kroger')!;
    const withoutLocation = { ...store, krogerLocationId: undefined };
    await expect(krogerProvider.fetchOffers(withoutLocation, buildProducts().slice(0, 2))).resolves.toEqual([]);
  });
});

// ── Regressions found by adversarial review ───────────────────────────────
// Both bugs below produced confidently-wrong recommendations, and the original
// suite passed while they were live — it asserted the DIRECTION of a number
// without asserting it was computed from the right set of items.

/** The real seeded catalog, which is where both bugs actually surfaced. */
function realIndex(): OfferIndex {
  const products = buildProducts();
  const offers = buildOffers(products, '2026-08-28T00:00:00.000Z');
  const productsByItem = new Map<string, Product[]>();
  for (const product of products) {
    const list = productsByItem.get(product.itemId) ?? [];
    list.push(product);
    productsByItem.set(product.itemId, list);
  }
  return {
    productsByItem,
    offers: new Map(offers.map((o) => [offerKey(o.productId, o.storeId), o])),
    storesById: new Map(STORES.map((s) => [s.id, s])),
  };
}

describe('savings ladder completeness (regression)', () => {
  test('a ladder plan never "saves" money by dropping a basket item', () => {
    // Was: {bananas, olive-oil, fairlife-milk} over {WinCo, TJ, Smith's} showed
    // "WinCo+TJ save $4.39" — and $4.39 was exactly the Fairlife price it
    // silently omitted, because only Smith's carries it.
    const index = realIndex();
    const result = optimize(index, [
      { itemId: 'bananas', quantity: 1 },
      { itemId: 'olive-oil', quantity: 1 },
      { itemId: 'fairlife-milk', quantity: 1 },
    ], ['winco-redwood', 'tj-sugarhouse', 'smiths-900e']);

    expect(result.winner.unavailableItemIds).toEqual([]);
    for (const row of result.ladder) {
      expect(row.plan.unavailableItemIds).toEqual([]);
      expect(row.plan.assignments).toHaveLength(3);
    }
  });

  test('property sweep: no ladder row is ever less complete than the winner', () => {
    const index = realIndex();
    const itemIds = ['bananas', 'olive-oil', 'fairlife-milk', 'lacroix', 'dark-chocolate', 'maple-syrup', 'salmon-fillet', 'whole-milk'];
    const storeSets = [
      ['winco-redwood', 'tj-sugarhouse', 'smiths-900e'],
      ['winco-redwood', 'costco-sandy', 'harmons-brickyard'],
      ['walmart-3300s', 'sprouts-sugarhouse', 'tj-sugarhouse', 'winco-redwood'],
    ];

    let ladderRows = 0;
    for (const stores of storeSets) {
      for (let a = 0; a < itemIds.length; a++) {
        for (let b = a + 1; b < itemIds.length; b++) {
          for (let c = b + 1; c < itemIds.length; c++) {
            const basket = [itemIds[a], itemIds[b], itemIds[c]].map((itemId) => ({ itemId, quantity: 1 }));
            const result = optimize(index, basket, stores);
            for (const row of result.ladder) {
              ladderRows++;
              expect(row.plan.unavailableItemIds.length).toBeLessThanOrEqual(result.winner.unavailableItemIds.length);
              expect(row.savingsCents).toBeGreaterThan(0);
            }
          }
        }
      }
    }
    // Guard against the sweep passing because no ladder row was ever produced.
    expect(ladderRows).toBeGreaterThan(50);
  });
});

describe('headline ranking (regression)', () => {
  test('a narrow-range store cannot out-rank a complete one-stop store', () => {
    // Was: Costco carried 1 of 6 items yet headlined at $15.94 over a complete
    // one-stop Smith's at $16.24, by sourcing the other 5 items at the global
    // per-item minimum — i.e. by assuming three stops.
    const index = realIndex();
    const basket = ['bananas', 'sandwich-bread', 'marinara', 'heinz-ketchup', 'black-beans', 'chicken-broth'].map(
      (itemId) => ({ itemId, quantity: 1 }),
    );
    const result = optimize(index, basket, ['smiths-900e', 'harmons-brickyard', 'costco-sandy']);

    expect(result.winner.anchorId).toBe('smiths-900e');
    expect(result.winner.storeIds).toHaveLength(1);
    expect(result.winner.forcedStopIds).toEqual([]);
    // Every line comes from the anchor itself.
    expect(result.winner.assignments.every((a) => a.storeId === 'smiths-900e')).toBe(true);
  });

  test('gaps consolidate onto one extra store, not one store per item', () => {
    const index = realIndex();
    // Costco stocks almost none of these; the leftovers must land on a single
    // additional store rather than being cherry-picked across several.
    const basket = ['sandwich-bread', 'marinara', 'heinz-ketchup', 'black-beans', 'chicken-broth'].map((itemId) => ({
      itemId,
      quantity: 1,
    }));
    const plan = anchoredPlan(index, basket, ['costco-sandy', 'smiths-900e', 'harmons-brickyard'], 'costco-sandy');
    expect(plan.forcedStopIds.length).toBeLessThanOrEqual(1);
    const forcedStores = new Set(plan.assignments.filter((a) => a.forced).map((a) => a.storeId));
    expect(forcedStores.size).toBeLessThanOrEqual(1);
  });

  test('an anchor that supplies nothing is not a candidate for the headline', () => {
    // Was: Trader Joe's anchored plan had ZERO TJ assignments, tied WinCo's
    // plan, won on selection order, and rendered "WinCo doesn't carry chicken —
    // picked up at WinCo".
    const index = realIndex();
    const basket = ['chicken-breast', 'toilet-paper', 'trash-bags', 'dish-soap'].map((itemId) => ({ itemId, quantity: 1 }));
    const result = optimize(index, basket, ['tj-sugarhouse', 'winco-redwood']);

    expect(result.winner.anchorId).toBe('winco-redwood');
    const anchorLines = result.winner.assignments.filter((a) => a.storeId === result.winner.anchorId);
    expect(anchorLines.length).toBeGreaterThan(0);
    // The headline store is never also listed as one of its own forced stops.
    expect(result.winner.forcedStopIds).not.toContain(result.winner.anchorId);
  });

  test('runner-up is never the winner itself, even on an exact total tie', () => {
    const index = realIndex();
    const basket = ['chicken-breast', 'toilet-paper'].map((itemId) => ({ itemId, quantity: 1 }));
    const result = optimize(index, basket, ['tj-sugarhouse', 'winco-redwood', 'smiths-900e']);
    const winnerAnchor = result.winner.anchorId;
    expect(winnerAnchor).not.toBeNull();
    if (result.runnerUp && winnerAnchor != null) {
      expect(result.runnerUp.anchorId).not.toBe(winnerAnchor);
    }
    for (const entry of result.perStore) {
      expect(entry.plan.anchorId).toBe(entry.storeId);
    }
  });
});

describe('parseSize edge cases (regression)', () => {
  test('mixed fractions keep their whole number', () => {
    // Was: "1 1/2 lb" parsed as 0.5 lb — the leading 1 was silently dropped.
    expect(parseSize('1 1/2 lb')?.sizeBase).toBeCloseTo(24, 5);
    expect(parseSize('2 1/4 oz')?.sizeBase).toBeCloseTo(2.25, 5);
    expect(parseSize('1/2 gal')?.sizeBase).toBeCloseTo(64, 5);
  });

  test('a trailing pack count is a pack, not a unit', () => {
    // Was: "16.9 fl oz 6 pk" parsed as 6 ct — wrong dimension AND wrong size.
    const parsed = parseSize('16.9 fl oz 6 pk');
    expect(parsed?.dimension).toBe('volume');
    expect(parsed?.sizeBase).toBeCloseTo(16.9, 5);
    expect(parsed?.packMultiple).toBe(6);
  });

  test('a trailing count unit is NOT mistaken for a pack count', () => {
    const parsed = parseSize('18 ct');
    expect(parsed).toEqual({ sizeBase: 18, packMultiple: 1, dimension: 'count' });
  });

  test('refuses a zero denominator instead of returning Infinity', () => {
    expect(parseSize('1/0 lb')).toBeNull();
  });
});

describe('gap consolidation is minimum-stops, not greedy (regression)', () => {
  /**
   * Fixture built so that greedy max-coverage picks 3 stores where 2 suffice:
   *   anchor carries i0 only
   *   C covers {i1,i2,i4,i5}   <- greedy grabs this first (4 items)
   *   A covers {i1,i2,i3}
   *   B covers {i4,i5,i6}      <- A+B covers all six in TWO stops
   */
  function setCoverFixture() {
    const stores: Store[] = [
      { id: 'anchor', chainId: 'c-anchor', banner: 'Anchor', label: 'Anchor', address: '', driveMinutes: 5 },
      { id: 'a', chainId: 'c-a', banner: 'A', label: 'A', address: '', driveMinutes: 6 },
      { id: 'b', chainId: 'c-b', banner: 'B', label: 'B', address: '', driveMinutes: 7 },
      { id: 'c', chainId: 'c-c', banner: 'C', label: 'C', address: '', driveMinutes: 8 },
    ];
    const carries: Record<string, string[]> = {
      'c-anchor': ['i0'],
      'c-a': ['i1', 'i2', 'i3'],
      'c-b': ['i4', 'i5', 'i6'],
      'c-c': ['i1', 'i2', 'i4', 'i5'],
    };

    const productsByItem = new Map<string, Product[]>();
    const offers = new Map<string, Offer>();
    for (const store of stores) {
      for (const itemId of carries[store.chainId]) {
        const product: Product = {
          id: `${itemId}__${store.chainId}`, itemId, chainId: store.chainId, brand: 'x', name: itemId,
          sizeLabel: '1 ct', sizeBase: 1, dimension: 'count', packMultiple: 1, confidence: 'medium',
        };
        const list = productsByItem.get(itemId) ?? [];
        list.push(product);
        productsByItem.set(itemId, list);
        offers.set(offerKey(product.id, store.id), {
          productId: product.id, storeId: store.id, priceCents: 100,
          regularPriceCents: null, stock: 'unknown', provenance: 'seed', fetchedAt: '2026-01-01T00:00:00.000Z',
        });
      }
    }

    const index: OfferIndex = { productsByItem, offers, storesById: new Map(stores.map((s) => [s.id, s])) };
    const basket = ['i0', 'i1', 'i2', 'i3', 'i4', 'i5', 'i6'].map((itemId) => ({ itemId, quantity: 1 }));
    return { index, basket };
  }

  test('covers the gap in the fewest possible extra stops', () => {
    const { index, basket } = setCoverFixture();
    const plan = anchoredPlan(index, basket, ['anchor', 'a', 'b', 'c'], 'anchor');

    // Greedy produced 3 forced stops (c, then a, then b). Minimum is 2 (a + b).
    expect(plan.forcedStopIds).toHaveLength(2);
    expect(plan.forcedStopIds.sort()).toEqual(['a', 'b']);
    expect(plan.storeIds).toHaveLength(3); // anchor + 2
    expect(plan.unavailableItemIds).toEqual([]);
    expect(plan.assignments).toHaveLength(7);
  });

  test('still reports items nobody carries instead of dropping them', () => {
    const { index, basket } = setCoverFixture();
    const plan = anchoredPlan(index, [...basket, { itemId: 'nowhere', quantity: 1 }], ['anchor', 'a', 'b', 'c'], 'anchor');
    expect(plan.unavailableItemIds).toEqual(['nowhere']);
    expect(plan.assignments).toHaveLength(7);
  });
});

describe('gap resolution is complete and exact on the real catalog', () => {
  /** True when at least one Store in the selection genuinely carries the Item. */
  function carriedSomewhere(index: OfferIndex, itemId: string, storeIds: string[]): boolean {
    const stores = storeIds.map((id) => index.storesById.get(id)).filter((s): s is Store => s != null);
    return (index.productsByItem.get(itemId) ?? []).some((product) =>
      stores.some((store) => store.chainId === product.chainId && index.offers.has(offerKey(product.id, store.id))),
    );
  }

  test('never reports an item unavailable that some selected store actually carries', () => {
    // The risk in the exact-then-greedy design: if no subset of <= 3 extra
    // stores covers the gaps, the greedy fallback runs and could leave items
    // marked unavailable that a larger combination could have supplied. This
    // asserts that never happens for any anchor over the whole catalog.
    const index = realIndex();
    const allStores = STORES.map((store) => store.id);
    const fullBasket = ITEMS.map((item) => ({ itemId: item.id, quantity: 1 }));

    for (const anchor of allStores) {
      const plan = anchoredPlan(index, fullBasket, allStores, anchor);
      const wronglyUnavailable = plan.unavailableItemIds.filter((id) => carriedSomewhere(index, id, allStores));
      expect(wronglyUnavailable).toEqual([]);
      expect(plan.assignments).toHaveLength(fullBasket.length);
    }
  });

  test('the exact search covers every anchor well inside its stop budget', () => {
    // Observed worst case is 1 forced stop, against a search that is exact up to
    // 3 — so the greedy fallback is unreachable on this catalog. If a future
    // catalog change pushes this to 3, the fallback becomes live and this test
    // is the warning.
    const index = realIndex();
    const allStores = STORES.map((store) => store.id);
    const fullBasket = ITEMS.map((item) => ({ itemId: item.id, quantity: 1 }));

    for (const anchor of allStores) {
      const plan = anchoredPlan(index, fullBasket, allStores, anchor);
      expect(plan.forcedStopIds.length).toBeLessThan(3);
    }
  });

  test('forcedStopIds equals exactly the non-anchor stores actually assigned to', () => {
    const index = realIndex();
    const allStores = STORES.map((store) => store.id);
    const basket = ITEMS.slice(0, 30).map((item) => ({ itemId: item.id, quantity: 1 }));

    for (const anchor of allStores) {
      const plan = anchoredPlan(index, basket, allStores, anchor);
      const assigned = new Set(plan.assignments.map((a) => a.storeId));
      assigned.delete(anchor);
      expect([...plan.forcedStopIds].sort()).toEqual([...assigned].sort());
      // A forced assignment must never point back at the anchor.
      expect(plan.assignments.filter((a) => a.forced).every((a) => a.storeId !== anchor)).toBe(true);
    }
  });
});

describe('a live price is never judged against seeded history (regression)', () => {
  const points = (
    cents: number,
    days: number,
    provenance: 'seed' | 'live',
    onPromo = false,
  ): PricePoint[] =>
    Array.from({ length: days }, (_, i) => ({
      date: `2026-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, '0')}`,
      priceCents: cents,
      onPromo,
      provenance,
    }));

  test('live price + all-seeded history yields no verdict at all', () => {
    // Was: `price_history.provenance` was written but never read, so a real
    // $3.09 was scored against 89 placeholder points and confidently badged
    // "Real low" — comparing a live price to invented ones.
    const signal = analyzeDeal(points(499, 89, 'seed'), 309, false, 'live');
    expect(signal.verdict).toBe('no-basis');
    expect(signal.basis).toBe('seed');
    expect(signal.livePoints).toBe(0);
  });

  test('live price with too few live points still refuses to judge', () => {
    const history = [...points(499, 80, 'seed'), ...points(310, 5, 'live')];
    const signal = analyzeDeal(history, 309, false, 'live');
    expect(signal.verdict).toBe('no-basis');
    expect(signal.livePoints).toBe(5);
    expect(signal.basis).toBe('mixed');
  });

  test('once enough live points exist, ONLY live points are used', () => {
    // Seeded points sit far below the live ones. If they leaked into the window
    // the live price would read as "Running high" instead of a real low.
    const history = [...points(199, 60, 'seed'), ...points(499, 20, 'live')];
    const signal = analyzeDeal(history, 399, false, 'live');
    expect(signal.verdict).toBe('real-low');
    expect(signal.livePoints).toBe(20);
    // The proof the seeded points were excluded: 20 points in the window, and a
    // median of 499. Had the sixty seeded 199s leaked in, the median would have
    // been 199 and this price would read as "Running high" instead.
    expect(signal.windowDays).toBe(20);
    expect(signal.medianCents).toBe(499);
    expect(signal.lowCents).toBe(499);
  });

  test('a seeded price judged against seeded history is unaffected', () => {
    // Internally consistent and badged Seed throughout, so this stays a real
    // verdict — the fix must not blank out the default experience.
    const signal = analyzeDeal(points(499, 60, 'seed'), 349, true, 'seed');
    expect(signal.verdict).toBe('real-low');
    expect(signal.basis).toBe('seed');
  });

  test('every verdict has a label and a tone', () => {
    const verdicts: DealVerdict[] = ['real-low', 'good', 'typical', 'high', 'fake-sale', 'no-basis'];
    for (const verdict of verdicts) {
      expect(VERDICT_LABEL[verdict]).toBeTruthy();
      expect(VERDICT_TONE[verdict]).toBeTruthy();
    }
  });
});

describe('receipt parser', () => {
  // A realistic Smith's/Kroger-style receipt, including the awkward parts.
  const SMITHS = `
SMITH'S FOOD & DRUG
876 E 800 S  SALT LAKE CITY UT
STORE #0060   09/01/26  6:42PM

0001111041700 KRO WHOLE MILK GAL      3.29 F
BANANAS 2.13 lb @ $0.58/lb            1.24 F
2 @ 1.99  KRO LG EGGS 18CT            3.98 F
07 SHARP CHEDDAR 8OZ                  2.99 T
KRO OLIVE OIL 25OZ                   12.99 T
                    SUBTOTAL         24.49
                    TAX               1.06
                    TOTAL            25.55
                    DEBIT            25.55
THANK YOU FOR SHOPPING
`;

  test('reads plain, weighted and multi-quantity lines', () => {
    const receipt = parseReceipt(SMITHS);
    const byName = (fragment: string) => receipt.lines.find((line) => line.description.includes(fragment));

    expect(receipt.lines).toHaveLength(5);

    // Leading UPC stripped, tax flag stripped.
    expect(byName('WHOLE MILK')?.totalCents).toBe(329);
    expect(byName('WHOLE MILK')?.description).toBe('KRO WHOLE MILK GAL');

    // Weighted line: the LINE total is what was paid, not the per-pound rate.
    const bananas = byName('BANANAS');
    expect(bananas?.totalCents).toBe(124);
    expect(bananas?.weight).toEqual({ amount: 2.13, unit: 'lb', perUnitCents: 58 });

    // "2 @ 1.99" means quantity 2 and a line total of 3.98.
    const eggs = byName('LG EGGS');
    expect(eggs?.quantity).toBe(2);
    expect(eggs?.totalCents).toBe(398);

    // Leading department number stripped.
    expect(byName('SHARP CHEDDAR')?.description).toBe('SHARP CHEDDAR 8OZ');
  });

  test('never treats totals, tax or payment lines as items', () => {
    const receipt = parseReceipt(SMITHS);
    const text = receipt.lines.map((line) => line.description).join(' ').toUpperCase();
    for (const word of ['SUBTOTAL', 'TAX', 'TOTAL', 'DEBIT', 'THANK']) {
      expect(text).not.toContain(word);
    }
  });

  test('detects the store from the header', () => {
    expect(parseReceipt(SMITHS).detectedStore).toBe('kroger');
    expect(parseReceipt('WINCO FOODS\nMILK 2.98\n').detectedStore).toBe('winco');
    expect(parseReceipt("TRADER JOE'S\nBANANAS 0.29\n").detectedStore).toBe('traderjoes');
  });

  test('reconciles the parsed sum against the stated total', () => {
    const receipt = parseReceipt(SMITHS);
    const check = reconcile(receipt);
    // 3.29 + 1.24 + 3.98 + 2.99 + 12.99 = 24.49, matching the printed subtotal.
    expect(check.parsedTotalCents).toBe(2449);
    expect(receipt.statedTotalCents).toBe(2555);
    // The gap is sales tax, well inside tolerance.
    expect(check.differenceCents).toBe(106);
    expect(check.looksComplete).toBe(true);
  });

  test('flags an incomplete parse instead of quietly under-reporting', () => {
    // A receipt whose lines cannot be read should NOT look complete just
    // because the few lines we did read summed to something.
    const receipt = parseReceipt('SMITH\'S\nMILK 3.29\nTOTAL 48.10\n');
    const check = reconcile(receipt);
    expect(check.parsedTotalCents).toBe(329);
    expect(check.looksComplete).toBe(false);
  });

  test('a leading number that is a size is not mistaken for a quantity', () => {
    // "12 OZ COFFEE" is one 12oz bag, not twelve coffees.
    const receipt = parseReceipt("SMITH'S\n12 OZ COFFEE MED ROAST   8.99\n");
    expect(receipt.lines[0]?.quantity).toBe(1);
    expect(receipt.lines[0]?.totalCents).toBe(899);
  });

  test('refunds and zero-value lines are not treated as purchases', () => {
    const receipt = parseReceipt("SMITH'S\nMILK 3.29\nBOTTLE DEPOSIT REFUND -1.20\nFREEBIE 0.00\n");
    expect(receipt.lines).toHaveLength(1);
    expect(receipt.lines[0].totalCents).toBe(329);
  });
});
