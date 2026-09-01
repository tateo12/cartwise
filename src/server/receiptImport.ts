import { parseReceipt, reconcile, type ReceiptLine } from '@/core/receiptParser';
import { STORES } from '@/data/stores';
import { allItems, type ItemRecord } from '@/db/queries';

/**
 * Turns receipt text into a reviewable import.
 *
 * Every matched line becomes a `provenance: 'user'` price, which is the only
 * genuinely trustworthy price in the app: what you actually paid, at your actual
 * store, with their loyalty pricing already applied. It is also the sole route
 * to WinCo and Trader Joe's, which publish nothing online at any price.
 *
 * Because these prices become ground truth, matching is presented for review
 * rather than applied silently. A wrong match here would quietly poison every
 * comparison from then on.
 */

export interface MatchedReceiptLine {
  line: ReceiptLine;
  /** Best catalog match, or null when nothing scored well enough. */
  item: ItemRecord | null;
  /** 0 to 1. Shown to the user so a weak guess is visibly a guess. */
  confidence: number;
  /** Runners-up, so a wrong match is one click to fix rather than a retype. */
  alternatives: ItemRecord[];
  /** Per-unit price this line implies, in cents. */
  unitPriceCents: number;
}

export interface ReceiptImport {
  matched: MatchedReceiptLine[];
  unparsed: string[];
  storeId: string | null;
  detectedChainId: string | null;
  parsedTotalCents: number;
  statedTotalCents: number | null;
  differenceCents: number | null;
  looksComplete: boolean;
}

/** Receipt shorthand, expanded so abbreviations can match catalog names. */
const ABBREVIATIONS: Record<string, string> = {
  kro: '', gv: '', gg: '', wf: '', tj: '',
  wht: 'whole', wht_: 'whole', wh: 'whole',
  lg: 'large', sm: 'small', med: 'medium',
  chz: 'cheese', chdr: 'cheddar', ched: 'cheddar',
  yog: 'yogurt', yogrt: 'yogurt',
  chkn: 'chicken', chk: 'chicken', bnls: 'boneless',
  grnd: 'ground', gr: 'ground', bf: 'beef',
  bnna: 'banana', ban: 'banana',
  brd: 'bread', sndwch: 'sandwich',
  ju: 'juice', oj: 'orange juice',
  tp: 'toilet paper', pt: 'paper towels',
  ct: '', oz: '', lb: '', gal: '', pk: '',
};

function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    // Drop bare sizes: "18ct", "8oz", "2lb" carry no naming information.
    .replace(/\b\d+\s*(?:ct|oz|lb|lbs|gal|g|kg|ml|l|pk)\b/g, ' ')
    .replace(/\b\d+\b/g, ' ')
    .split(/\s+/)
    .map((word) => (word in ABBREVIATIONS ? ABBREVIATIONS[word] : word))
    .filter((word) => word.length > 1);
}

/**
 * Scores a receipt description against a catalog item.
 *
 * Deliberately simple token overlap, weighted toward the item's own words: a
 * receipt line is terse and abbreviated, so precision matters more than recall.
 */
function score(descriptionTokens: string[], item: ItemRecord): number {
  const itemTokens = normalize(`${item.brandName ?? ''} ${item.name}`);
  if (itemTokens.length === 0 || descriptionTokens.length === 0) return 0;

  const receiptSet = new Set(descriptionTokens);
  let hits = 0;
  for (const token of itemTokens) if (receiptSet.has(token)) hits++;

  const coverage = hits / itemTokens.length;
  // A single shared common word is not a match.
  if (hits === 0 || (hits === 1 && itemTokens.length > 2)) return 0;
  return coverage;
}

/** Matches one line, keeping the runners-up for correction. */
function matchLine(line: ReceiptLine, items: ItemRecord[]): MatchedReceiptLine {
  const tokens = normalize(line.description);
  const ranked = items
    .map((item) => ({ item, value: score(tokens, item) }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value);

  const best = ranked[0];
  // Weighted lines are priced per pound; the unit price is the line total.
  const unitPriceCents = line.quantity > 1 ? Math.round(line.totalCents / line.quantity) : line.totalCents;

  return {
    line,
    item: best && best.value >= 0.5 ? best.item : null,
    confidence: best?.value ?? 0,
    alternatives: ranked.slice(0, 4).map((entry) => entry.item),
    unitPriceCents,
  };
}

/** Maps a detected chain to one of the user's actual stores. */
function storeForChain(chainId: string | null): string | null {
  if (!chainId) return null;
  return STORES.find((store) => store.chainId === chainId)?.id ?? null;
}

export function buildReceiptImport(text: string): ReceiptImport {
  const receipt = parseReceipt(text);
  const check = reconcile(receipt);
  const items = allItems();

  return {
    matched: receipt.lines.map((line) => matchLine(line, items)),
    unparsed: receipt.unparsed,
    detectedChainId: receipt.detectedStore,
    storeId: storeForChain(receipt.detectedStore),
    parsedTotalCents: check.parsedTotalCents,
    statedTotalCents: receipt.statedTotalCents,
    differenceCents: check.differenceCents,
    looksComplete: check.looksComplete,
  };
}
