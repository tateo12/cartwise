import type { PantryRecord } from '@/db/queries';

/**
 * Restock prioritisation.
 *
 * The pantry knows what you buy and roughly how often, so it can suggest what
 * next week's basket should contain without you rebuilding it by hand.
 */

export interface RestockSuggestion {
  itemId: string;
  /** Higher is more urgent. Unitless — only the ordering is meaningful. */
  score: number;
  daysSincePurchase: number | null;
  /** Short human explanation of why this surfaced. */
  reason: string;
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T12:00:00Z`);
  const to = Date.parse(`${toIso}T12:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

/**
 * Scores one pantry entry for restocking.
 *
 * Everything around the score is done: `daysSincePurchase`, the no-history
 * guard, the assumed cadence, and the human-readable reason. What remains is
 * the scoring rule itself, which is a genuine product judgement rather than a
 * mechanical calculation.
 */
export function restockPriority(record: PantryRecord, todayIso: string): RestockSuggestion {
  const daysSincePurchase = record.lastPurchasedAt ? daysBetween(record.lastPurchasedAt, todayIso) : null;

  // Never bought, or no date recorded: nothing to predict from.
  if (daysSincePurchase == null) {
    return { itemId: record.itemId, score: 0, daysSincePurchase: null, reason: 'no purchase history' };
  }

  // A staple is something bought on 3+ trips. Staples are assumed to run out on
  // a roughly weekly cadence; everything else on a much slower one.
  const assumedCadence = record.isStaple ? 7 : 21;

  // TODO(human): compute `score` — how urgently this item needs restocking.
  //
  // Available inputs:
  //   daysSincePurchase  number  days since the last logged purchase
  //   assumedCadence     number  7 for staples, 21 otherwise
  //   record.purchaseCount  number  how many trips it has appeared on
  //   record.isStaple       boolean
  //
  // Higher = more urgent. Only the ORDERING matters (the UI renders it as a
  // bar, never as a number), and `suggestRestock` below drops anything scoring
  // under 1.0 — so make 1.0 mean roughly "due now".
  const score = 0;

  const reason = record.isStaple
    ? `staple · bought ${record.purchaseCount}× · ${daysSincePurchase}d ago`
    : `bought ${record.purchaseCount}× · ${daysSincePurchase}d ago`;

  return { itemId: record.itemId, score, daysSincePurchase, reason };
}

/** Entries worth putting in next week's basket, most urgent first. */
export function suggestRestock(records: PantryRecord[], todayIso: string, threshold = 1): RestockSuggestion[] {
  return records
    .map((record) => restockPriority(record, todayIso))
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score);
}
