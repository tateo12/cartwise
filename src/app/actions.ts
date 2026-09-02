'use server';

import { revalidatePath } from 'next/cache';
import { refreshLiveOffers, type RefreshReport } from '@/db/live';
import { addToKrogerCart, disconnectKroger, type CartPushResult } from '@/providers/krogerCart';
import { buildOfferIndex } from '@/db/queries';
import { bestAtStore } from '@/core/optimizer';
import { buildBasketView } from '@/server/view';
import { buildReceiptImport, type ReceiptImport } from '@/server/receiptImport';
import { fetchFuelPrices, fetchMakes, fetchModels, fetchTrims, fetchVehicleEconomy, fetchYears, type MenuOption } from '@/providers/fuelEconomy';
import { geocodeAddress } from '@/providers/geocode';
import { setSettingText, setTripSettings, tripSettings } from '@/db/queries';
import {
  ValidationError,
  assertIsoDate,
  assertItemId,
  assertOptionalPriceCents,
  assertPriceCents,
  assertQuantity,
  assertReceiptLines,
  assertStoreIds,
  assertStoreId,
} from '@/server/validate';
import { basket, selectedStoreIds } from '@/db/queries';
import {
  addWatch,
  clearBasket,
  pinMatch,
  recordReceipt,
  removeWatch,
  setBasketQuantity,
  setSelectedStores,
  unpinMatch,
  userReceiptExists,
} from '@/db/queries';

/**
 * Server actions. Each one mutates and then revalidates every surface that
 * could be showing the changed data — a stale basket total is worse than a slow
 * one, because the user acts on it in a store.
 */

/**
 * Invalidates the whole route tree under the root layout.
 *
 * A hardcoded path list was wrong here: it silently missed the dynamic
 * `/item/[id]` route, so confirming a match or changing the basket on an item
 * page left that page showing pre-mutation data. Every mutation in this app can
 * change every surface (a store toggle rewrites all totals), so tree-wide
 * invalidation is both correct and cheap — these pages are `force-dynamic` and
 * hold no data cache to throw away.
 */
function revalidateAll(): void {
  revalidatePath('/', 'layout');
}

export async function updateBasketQuantityAction(itemId: string, quantity: number): Promise<void> {
  setBasketQuantity(assertItemId(itemId), assertQuantity(quantity));
  revalidateAll();
}

export async function clearBasketAction(): Promise<void> {
  clearBasket();
  revalidateAll();
}

export async function setSelectedStoresAction(storeIds: string[]): Promise<void> {
  // An empty selection is allowed — the UI explains that nothing can be
  // compared — but it must never be silently replaced with a default.
  setSelectedStores(assertStoreIds(storeIds));
  revalidateAll();
}

export async function addWatchAction(itemId: string, targetCents: number | null): Promise<void> {
  addWatch(assertItemId(itemId), assertOptionalPriceCents(targetCents));
  revalidateAll();
}

export async function removeWatchAction(itemId: string): Promise<void> {
  removeWatch(assertItemId(itemId));
  revalidateAll();
}

export async function pinMatchAction(productId: string, itemId: string): Promise<void> {
  // productId is validated against the catalog inside pinMatch's own lookup —
  // itemId is the one that must exist for the pin to mean anything.
  pinMatch(productId, assertItemId(itemId));
  revalidateAll();
}

export async function unpinMatchAction(productId: string): Promise<void> {
  unpinMatch(productId);
  revalidateAll();
}

export async function recordReceiptAction(
  storeId: string,
  purchasedAt: string,
  lines: { itemId: string; priceCents: number; quantity: number }[],
): Promise<void> {
  recordReceipt(assertStoreId(storeId), assertIsoDate(purchasedAt), assertReceiptLines(lines));
  revalidateAll();
}

/**
 * Pulls real prices from every configured live provider.
 *
 * Returns the report rather than throwing on a partial failure: a refresh that
 * updated 40 of 60 products is useful, and the caller shows what was missed.
 */
export async function refreshLiveOffersAction(): Promise<RefreshReport> {
  const report = await refreshLiveOffers();
  revalidateAll();
  return report;
}

/**
 * Prices exactly the current basket at exactly the selected stores.
 *
 * This is what "Ready" runs. Scoping it to the list is the whole point: a
 * 14-line basket at 4 stores is ~56 lookups, where refreshing the catalog
 * everywhere is ~480. Fetching prices nobody asked for is slower for the user
 * and far harder to justify to the retailer.
 */
export async function priceMyListAction(): Promise<RefreshReport> {
  const itemIds = basket().map((line) => line.itemId);
  const storeIds = selectedStoreIds();
  const report = await refreshLiveOffers({ itemIds, storeIds });
  revalidateAll();
  return report;
}

export interface LogTripReport {
  receiptsCreated: number;
  totalCents: number;
  storeLabels: string[];
  /** Stores already logged for today — skipped rather than duplicated. */
  alreadyLogged: string[];
}

/**
 * Records the currently-recommended trip as real purchases.
 *
 * Deliberately takes NO arguments: the prices are read server-side from the
 * current plan rather than accepted from the client. A receipt is the one place
 * in the app that produces `provenance: 'user'` data, so letting a caller post
 * arbitrary prices into it would poison the only trustworthy price source.
 *
 * One receipt per store, because a two-stop trip really is two receipts.
 */
export async function logCurrentPlanAction(): Promise<LogTripReport> {
  const view = buildBasketView();
  const byStore = new Map<string, { itemId: string; priceCents: number; quantity: number }[]>();

  for (const assignment of view.result.winner.assignments) {
    const lines = byStore.get(assignment.storeId) ?? [];
    lines.push({
      itemId: assignment.itemId,
      priceCents: assignment.offer.priceCents,
      quantity: assignment.quantity,
    });
    byStore.set(assignment.storeId, lines);
  }

  const purchasedAt = new Date().toISOString().slice(0, 10);
  const storeLabels: string[] = [];
  const alreadyLogged: string[] = [];
  let receiptsCreated = 0;

  for (const [storeId, lines] of byStore) {
    if (lines.length === 0) continue;
    const banner = view.selectedStores.find((s) => s.id === storeId)?.banner ?? storeId;

    // Idempotent per (store, day): pressing this twice must not double-count
    // purchases, or every basket line eventually becomes a "staple".
    if (userReceiptExists(storeId, purchasedAt)) {
      alreadyLogged.push(banner);
      continue;
    }

    recordReceipt(storeId, purchasedAt, lines);
    receiptsCreated++;
    storeLabels.push(banner);
  }

  revalidateAll();
  return { receiptsCreated, totalCents: view.result.winner.totalCents, storeLabels, alreadyLogged };
}

/**
 * Pushes one store's lines into the customer's Kroger cart.
 *
 * Takes only item ids and quantities from the client. UPCs and prices are
 * resolved server-side, so a caller cannot inject a product or a price into
 * your real cart.
 */
export async function pushKrogerCartAction(
  storeId: string,
  lines: { itemId: string; quantity: number }[],
): Promise<CartPushResult> {
  const validStoreId = assertStoreId(storeId);
  const index = buildOfferIndex();

  const items = lines.flatMap((line) => {
    const itemId = assertItemId(line.itemId);
    const quantity = assertQuantity(line.quantity);
    if (quantity < 1) return [];
    const found = bestAtStore(index, itemId, validStoreId);
    const upc = found?.offer.sourceUpc;
    // No UPC means no cart push for this line. Reported, never faked.
    return [{ upc: upc ?? '', quantity }];
  });

  const result = await addToKrogerCart(items);
  revalidateAll();
  return result;
}

export async function disconnectKrogerAction(): Promise<void> {
  disconnectKroger();
  revalidateAll();
}

/**
 * Parses pasted receipt text and matches it to the catalog for review.
 *
 * Read-only: nothing is saved until you confirm. These become the only
 * `provenance: 'user'` prices in the app, so a wrong match would become ground
 * truth and quietly poison every later comparison.
 */
export async function analyzeReceiptAction(text: string): Promise<ReceiptImport> {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new ValidationError('Paste some receipt text first.');
  }
  // Generous, but bounded: a long receipt is a few thousand characters.
  if (text.length > 100_000) throw new ValidationError('That is too long to be a receipt.');
  return buildReceiptImport(text);
}

/**
 * Saves the confirmed lines as a real purchase.
 *
 * Only itemId, price and quantity cross the boundary, all validated, so a
 * malformed paste cannot write nonsense into your price history.
 */
export async function saveReceiptImportAction(
  storeId: string,
  purchasedAt: string,
  lines: { itemId: string; priceCents: number; quantity: number }[],
): Promise<{ receiptId: number; lineCount: number }> {
  const validLines = assertReceiptLines(lines);
  const receiptId = recordReceipt(assertStoreId(storeId), assertIsoDate(purchasedAt), validLines);
  revalidateAll();
  return { receiptId, lineCount: validLines.length };
}

// ── Trip settings: home, vehicle, fuel price ──────────────────────────────

/**
 * Pulls the current national average pump price from the EPA.
 *
 * Overwrites only an EPA-sourced or default value: a price the user typed
 * themselves is theirs to keep, and silently replacing it would be worse than
 * being slightly stale.
 */
export async function refreshFuelPriceAction(): Promise<{ ok: boolean; cents?: number; reason?: string }> {
  const current = tripSettings();
  if (current.fuelSource === 'manual') {
    return { ok: false, reason: 'You set this price yourself, so it was left alone.' };
  }

  const prices = await fetchFuelPrices();
  if (!prices) return { ok: false, reason: 'Could not reach the EPA price service.' };

  setTripSettings({ fuelPriceCents: prices.regularCents });
  setSettingText('fuel_price_source', 'epa');
  setSettingText('fuel_price_fetched_at', new Date().toISOString());
  revalidateAll();
  return { ok: true, cents: prices.regularCents };
}

export async function setFuelPriceAction(cents: number): Promise<void> {
  setTripSettings({ fuelPriceCents: assertPriceCents(cents) });
  setSettingText('fuel_price_source', 'manual');
  revalidateAll();
}

export async function setHomeAction(address: string): Promise<{ ok: boolean; label?: string; reason?: string }> {
  if (typeof address !== 'string' || address.trim().length < 3) {
    return { ok: false, reason: 'Enter a street address, cross-streets, or a ZIP code.' };
  }
  const found = await geocodeAddress(address);
  if (!found) return { ok: false, reason: 'Could not find that address.' };

  setTripSettings({ lat: found.lat, lon: found.lon });
  setSettingText('home_label', found.label);
  revalidateAll();
  return { ok: true, label: found.label };
}

/** Vehicle picker steps. Each is a plain read from the EPA menu endpoints. */
export async function vehicleYearsAction(): Promise<MenuOption[]> {
  return fetchYears();
}
export async function vehicleMakesAction(year: string): Promise<MenuOption[]> {
  return fetchMakes(year);
}
export async function vehicleModelsAction(year: string, make: string): Promise<MenuOption[]> {
  return fetchModels(year, make);
}
export async function vehicleTrimsAction(year: string, make: string, model: string): Promise<MenuOption[]> {
  return fetchTrims(year, make, model);
}

/**
 * Sets mpg from a specific EPA vehicle record.
 *
 * Uses the COMBINED rating: a grocery run is town driving, so the highway
 * figure would understate what a detour costs.
 */
export async function setVehicleAction(vehicleId: string): Promise<{ ok: boolean; label?: string; mpg?: number; reason?: string }> {
  const economy = await fetchVehicleEconomy(vehicleId);
  if (!economy) return { ok: false, reason: 'Could not read that vehicle from the EPA.' };

  setTripSettings({ mpg: economy.combinedMpg });
  setSettingText('vehicle_label', economy.label);
  revalidateAll();
  return { ok: true, label: economy.label, mpg: economy.combinedMpg };
}

export async function setMpgAction(mpg: number): Promise<void> {
  if (typeof mpg !== 'number' || !Number.isFinite(mpg) || mpg <= 0 || mpg > 200) {
    throw new ValidationError('Enter an mpg between 1 and 200.');
  }
  setTripSettings({ mpg });
  setSettingText('vehicle_label', `${mpg} mpg (entered manually)`);
  revalidateAll();
}
