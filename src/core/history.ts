/**
 * Price history analysis — the "is this actually a deal?" engine.
 *
 * A retailer's SALE tag is a marketing artifact, not evidence. The only way to
 * know whether a price is good is to compare it against what that exact
 * Product has actually cost at that exact Store recently.
 */

import type { Provenance } from './domain';

export interface PricePoint {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  priceCents: number;
  /** True when the shelf tag claimed a promotion on that day. */
  onPromo: boolean;
  /** Where this point came from. Live prices must not be judged against seeded ones. */
  provenance: Provenance;
}

export type DealVerdict =
  /** At or near the lowest this has been in the window. Buy now. */
  | 'real-low'
  /** Below the typical price, though not a record. */
  | 'good'
  /** Around its normal price. */
  | 'typical'
  /** Near the top of its range. Wait if you can. */
  | 'high'
  /** Tagged as a sale while priced at or above the recent norm. */
  | 'fake-sale'
  /**
   * We cannot honestly judge this price yet — typically a live price whose
   * history is still seeded. Comparing a real $3.09 against a placeholder
   * 90-day low is a category error, not a cautious estimate.
   */
  | 'no-basis';

export interface DealSignal {
  verdict: DealVerdict;
  /** What the window was actually made of. */
  basis: 'live' | 'seed' | 'mixed' | 'none';
  /** Live points available in the window. */
  livePoints: number;
  /** Where the current price sits in the window, 0 = cheapest ever seen. */
  percentile: number;
  medianCents: number;
  lowCents: number;
  highCents: number;
  /** Cents above the window low. Zero means this IS the low. */
  aboveLowCents: number;
  windowDays: number;
}

/** Linear-interpolated percentile of a sorted array. */
function percentileOf(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * fraction;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (pos - lower);
}

/** Fraction of window observations at or above `value`, i.e. how good it is. */
function rankOf(sorted: number[], value: number): number {
  if (sorted.length === 0) return 0.5;
  let below = 0;
  for (const v of sorted) {
    if (v < value) below++;
    else break;
  }
  return below / sorted.length;
}

/** Live points needed before a live price can be judged against its own history. */
const MIN_LIVE_POINTS = 14;

/**
 * Classifies the current price against its own history.
 *
 * Thresholds are deliberately conservative: `real-low` requires both bottom-
 * decile ranking AND a material gap below the median, so a flat-priced staple
 * that wobbles by a penny never gets flagged as a screaming deal.
 *
 * `currentProvenance` matters. A seeded price judged against seeded history is
 * internally consistent and badged Seed throughout, so it is fine. A LIVE price
 * judged against seeded history is not — the comparison is meaningless, and it
 * returns `no-basis` until enough live points have accumulated. Once they have,
 * only the live points are used.
 */
export function analyzeDeal(
  history: PricePoint[],
  currentCents: number,
  currentOnPromo: boolean,
  currentProvenance: Provenance = 'seed',
): DealSignal {
  const livePoints = history.filter((point) => point.provenance === 'live').length;
  const basis: DealSignal['basis'] =
    history.length === 0 ? 'none' : livePoints === 0 ? 'seed' : livePoints === history.length ? 'live' : 'mixed';

  // A live price can only be judged against live history.
  const usable = currentProvenance === 'live' ? history.filter((point) => point.provenance === 'live') : history;

  const prices = usable.map((p) => p.priceCents).sort((a, b) => a - b);
  const median = percentileOf(prices, 0.5);
  const p10 = percentileOf(prices, 0.1);
  const p25 = percentileOf(prices, 0.25);
  const p90 = percentileOf(prices, 0.9);
  const low = prices.length ? prices[0] : currentCents;
  const high = prices.length ? prices[prices.length - 1] : currentCents;
  const percentile = rankOf(prices, currentCents);

  const base: Omit<DealSignal, 'verdict'> = {
    basis,
    livePoints,
    percentile,
    medianCents: Math.round(median),
    lowCents: low,
    highCents: high,
    aboveLowCents: Math.max(0, currentCents - low),
    windowDays: usable.length,
  };

  // A live price without enough live history: say we cannot tell, rather than
  // dressing up a comparison against placeholder numbers as analysis.
  if (currentProvenance === 'live' && livePoints < MIN_LIVE_POINTS) {
    return { ...base, verdict: 'no-basis' };
  }

  // Not enough history to make a claim — say so rather than guess.
  if (prices.length < 14) return { ...base, verdict: 'typical' };

  // The fake-sale check runs FIRST: a promo tag at or above the norm is the
  // most useful thing we can tell the user, and it would otherwise be
  // swallowed by the 'typical' bucket.
  if (currentOnPromo && currentCents >= median * 0.99) return { ...base, verdict: 'fake-sale' };

  if (currentCents <= p10 && currentCents <= median * 0.92) return { ...base, verdict: 'real-low' };
  if (currentCents <= p25) return { ...base, verdict: 'good' };
  if (currentCents >= p90) return { ...base, verdict: 'high' };
  return { ...base, verdict: 'typical' };
}

export const VERDICT_LABEL: Record<DealVerdict, string> = {
  'real-low': 'Real low',
  good: 'Good price',
  typical: 'Typical price',
  high: 'Running high',
  'fake-sale': 'Fake sale',
  'no-basis': 'No history yet',
};

/** Tailwind class per verdict. Kept next to the labels so they can't drift apart. */
export const VERDICT_TONE: Record<DealVerdict, string> = {
  'real-low': 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/30',
  good: 'text-teal-300 bg-teal-500/10 ring-teal-500/30',
  typical: 'text-zinc-400 bg-zinc-500/10 ring-zinc-500/25',
  high: 'text-amber-300 bg-amber-500/10 ring-amber-500/30',
  'fake-sale': 'text-rose-300 bg-rose-500/10 ring-rose-500/30',
  'no-basis': 'text-zinc-500 bg-zinc-500/[0.07] ring-zinc-500/20',
};
