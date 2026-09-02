import type { Plan, Store } from '@/core/domain';
import { optimize } from '@/core/optimizer';
import { formatUnitPrice, unitPriceCents } from '@/core/units';
import { allItems, basket, buildOfferIndex, selectedStoreIds, tripSettings, type ItemRecord } from '@/db/queries';
import { netSaving, tripCost } from '@/core/geo';
import { storeLinkFor } from '@/data/storeLinks';
import { storeById } from '@/data/stores';
import { krogerCartStatus, type KrogerCartStatus } from '@/providers/krogerCart';

/**
 * The shopping-trip flow.
 *
 * Turns the optimizer's output into something you can act on: a set of concrete
 * plans to choose between, each already split into per-store shopping lists with
 * a way to order from that store.
 *
 * The plans come straight from `optimize`, so the same rules hold: every total
 * buys the COMPLETE basket, stop counts are truthful, and a plan is never made
 * to look cheaper by quietly dropping an item.
 */

export interface TripLine {
  item: ItemRecord;
  quantity: number;
  /** Price for the whole line (quantity x pack price). */
  lineTotalCents: number;
  /** Single pack price, for the shopping list. */
  unitPackCents: number;
  productLabel: string;
  sizeLabel: string;
  unitPrice: string;
  /** True when this line is only here because the anchor store lacks it. */
  forced: boolean;
  /** Resolved search URL for this item at this store, or null if none exists. */
  searchUrl: string | null;
}

export interface TripStoreGroup {
  store: Store;
  lines: TripLine[];
  subtotalCents: number;
  /**
   * How to order from this store. Plain strings only: functions cannot cross
   * the server/client boundary, and a URL builder handed to a client component
   * is a runtime error rather than a type error.
   */
  link: { chainId: string; label: string; homeUrl: string; instacart: boolean } | null;
  /** Plain-text list, precomputed so the copy button needs no client logic. */
  listText: string;
}

export interface TripOption {
  /** Stable id, used as the radio value. */
  id: string;
  /** Short label: "One stop", "Two stops". */
  label: string;
  stops: number;
  totalCents: number;
  /** Cents saved versus the one-stop headline. Zero for the headline itself. */
  savingsCents: number;
  driveMinutes: number;
  /** Estimated round-trip road miles, home out and home again. */
  miles: number;
  /** Estimated fuel cost of the whole trip, in cents. */
  fuelCents: number;
  /** Fuel this plan costs OVER the one-stop baseline. */
  extraFuelCents: number;
  /**
   * Grocery saving minus the extra fuel. This is the number that answers
   * "is the detour worth it", and it can be negative.
   */
  netSavingsCents: number;
  /** True when the plan still wins after paying for the driving. */
  worthIt: boolean;
  /** True for the plan the dashboard recommends. */
  recommended: boolean;
  groups: TripStoreGroup[];
  /** Items this plan cannot supply at all. */
  unavailable: ItemRecord[];
}

export interface TripView {
  options: TripOption[];
  /** Home position and vehicle used for the fuel maths. */
  settings: ReturnType<typeof tripSettings>;
  /** Whether a real cart push is available for the Kroger-family store. */
  krogerCart: KrogerCartStatus;
  itemCount: number;
  lineCount: number;
  selectedStores: Store[];
  /** True when nothing can be planned yet. */
  empty: boolean;
}

const STOP_LABELS = ['No stops', 'One stop', 'Two stops', 'Three stops'];

function groupPlan(plan: Plan, items: Map<string, ItemRecord>): TripStoreGroup[] {
  const byStore = new Map<string, TripLine[]>();

  for (const assignment of plan.assignments) {
    const item = items.get(assignment.itemId);
    if (!item) continue;
    const chainId = storeById.get(assignment.storeId)?.chainId;
    const chainLink = chainId ? storeLinkFor(chainId) : null;

    const perUnit = unitPriceCents(
      assignment.offer.priceCents,
      assignment.product.sizeBase,
      assignment.product.packMultiple,
    );

    const line: TripLine = {
      item,
      quantity: assignment.quantity,
      lineTotalCents: assignment.lineTotalCents,
      unitPackCents: assignment.offer.priceCents,
      // A store brand's name is the banner, which is noise on a shopping list.
      productLabel:
        assignment.product.brand === storeById.get(assignment.storeId)?.banner
          ? 'store brand'
          : assignment.product.brand,
      sizeLabel: assignment.product.sizeLabel,
      unitPrice: formatUnitPrice(perUnit, assignment.product.dimension),
      forced: assignment.forced,
      searchUrl: chainLink ? chainLink.url(item.name) : null,
    };

    const list = byStore.get(assignment.storeId) ?? [];
    list.push(line);
    byStore.set(assignment.storeId, list);
  }

  const groups: TripStoreGroup[] = [];
  for (const [storeId, lines] of byStore) {
    const store = storeById.get(storeId);
    if (!store) continue;
    const link = storeLinkFor(store.chainId);
    const sorted = lines.sort((a, b) => b.lineTotalCents - a.lineTotalCents);
    const subtotalCents = sorted.reduce((sum, line) => sum + line.lineTotalCents, 0);
    const group: TripStoreGroup = {
      store,
      // Biggest lines first: those are the ones worth double-checking in aisle.
      lines: sorted,
      subtotalCents,
      link: link
        ? { chainId: store.chainId, label: link.label, homeUrl: link.home, instacart: link.instacart === true }
        : null,
      listText: '',
    };
    group.listText = shoppingListText(group);
    groups.push(group);
  }

  // Nearest store first, which is the order you would actually drive them.
  return groups.sort((a, b) => a.store.driveMinutes - b.store.driveMinutes);
}

/**
 * Builds the choosable plans.
 *
 * Exactly the optimizer's own output: the one-stop winner plus each multi-stop
 * plan that genuinely beats it. Nothing invented, nothing padded, so if only one
 * option exists that is the honest answer rather than a thin menu.
 */
export function buildTripView(): TripView {
  const index = buildOfferIndex();
  const lines = basket();
  const selected = selectedStoreIds();
  const items = new Map(allItems().map((item) => [item.id, item]));

  if (selected.length === 0 || lines.length === 0) {
    return {
      options: [],
      settings: tripSettings(),
      krogerCart: krogerCartStatus(),
      itemCount: 0,
      lineCount: lines.length,
      selectedStores: [],
      empty: true,
    };
  }

  const result = optimize(index, lines, selected);
  const settings = tripSettings();

  /** Route distance and fuel for a plan's actual stops. */
  const costOf = (plan: Plan) =>
    tripCost(
      settings.home,
      plan.storeIds.flatMap((id) => {
        const store = index.storesById.get(id);
        return store ? [{ id, at: { lat: store.lat, lon: store.lon } }] : [];
      }),
      { mpg: settings.mpg, fuelPriceCents: settings.fuelPriceCents },
    );

  // The one-stop winner is the baseline every detour is measured against.
  const baseline = costOf(result.winner);

  const toOption = (plan: Plan, recommended: boolean): TripOption => {
    const cost = costOf(plan);
    const grocerySaving = Math.max(0, result.winner.totalCents - plan.totalCents);
    const net = netSaving(grocerySaving, baseline.fuelCents, cost.fuelCents);
    return {
    id: plan.storeIds.join('+') || 'none',
    label: STOP_LABELS[Math.min(plan.storeIds.length, STOP_LABELS.length - 1)] ?? `${plan.storeIds.length} stops`,
    stops: plan.storeIds.length,
    totalCents: plan.totalCents,
    savingsCents: grocerySaving,
    driveMinutes: plan.driveMinutes,
    miles: cost.miles,
    fuelCents: cost.fuelCents,
    extraFuelCents: net.extraFuelCents,
    netSavingsCents: net.netSavingsCents,
    // The recommended one-stop plan is the baseline, so it is trivially "worth it".
    worthIt: recommended || net.worthIt,
    recommended,
    groups: groupPlan(plan, items),
    unavailable: plan.unavailableItemIds
      .map((id) => items.get(id))
      .filter((item): item is ItemRecord => item != null),
    };
  };

  const options: TripOption[] = [
    toOption(result.winner, true),
    ...result.ladder.map((row) => toOption(row.plan, false)),
  ];

  return {
    options,
    settings,
    krogerCart: krogerCartStatus(),
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    lineCount: lines.length,
    selectedStores: selected
      .map((id) => index.storesById.get(id))
      .filter((store): store is Store => store != null),
    empty: false,
  };
}

/** Plain-text shopping list for one store, for the copy button. */
export function shoppingListText(group: TripStoreGroup): string {
  const header = `${group.store.label}  (${(group.subtotalCents / 100).toFixed(2)})`;
  const body = group.lines
    .map((line) => {
      const qty = line.quantity > 1 ? ` x${line.quantity}` : '';
      return `- ${line.item.name}${qty}  ${line.sizeLabel}  $${(line.lineTotalCents / 100).toFixed(2)}`;
    })
    .join('\n');
  return `${header}\n${body}`;
}
