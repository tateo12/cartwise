/**
 * Grocery receipt parser.
 *
 * Turns the text of a till receipt into line items. This is the only route to
 * genuinely real prices that needs no API and no scraping: it is what you
 * actually paid, at your actual store, including their loyalty pricing. It is
 * also the only way to ever price WinCo or Trader Joe's, which publish nothing
 * online.
 *
 * Receipts are messy and every chain formats differently, so this is
 * deliberately conservative: a line it cannot read confidently is returned as
 * unparsed for the user to fix, never guessed at. A wrong price entered as
 * ground truth is worse than a missing one, because it poisons the comparison
 * permanently.
 */

export interface ReceiptLine {
  /** Item text as printed, cleaned of trailing tax flags. */
  description: string;
  /** Price actually charged for the whole line, in cents. */
  totalCents: number;
  /** Units bought. Weighted items report 1 with `weight` set. */
  quantity: number;
  /** Set for weight-priced lines, e.g. 2.13 lb of bananas. */
  weight?: { amount: number; unit: string; perUnitCents: number };
  /** The raw source line, so the UI can show what it came from. */
  raw: string;
}

export interface ParsedReceipt {
  lines: ReceiptLine[];
  /** Lines that look like items but could not be read confidently. */
  unparsed: string[];
  /** Receipt total, when the receipt states one. Used as a sanity check. */
  statedTotalCents: number | null;
  /** Store name, if a known banner appears in the header. */
  detectedStore: string | null;
}

/** Totals, tax and payment lines are not items. */
const NON_ITEM =
  /^\s*(?:sub\s*-?\s*total|total|tax|balance|change|cash|credit|debit|visa|mastercard|amex|discover|tender|payment|savings|you\s+saved|coupon|loyalty|member|points|order\s+total|net\s+sales|items?\s+sold|thank\s+you|receipt|store\s*#|tel|phone|www\.|http)/i;

/** Chain names as they appear in receipt headers, mapped to our chain ids. */
const STORE_SIGNATURES: { pattern: RegExp; chainId: string }[] = [
  { pattern: /\bsmith'?s\b|\bkroger\b/i, chainId: 'kroger' },
  { pattern: /\bwinco\b/i, chainId: 'winco' },
  { pattern: /\bwal-?mart\b/i, chainId: 'walmart' },
  { pattern: /\btarget\b/i, chainId: 'target' },
  { pattern: /\bcostco\b|\bwholesale\b/i, chainId: 'costco' },
  { pattern: /\bharmons\b/i, chainId: 'harmons' },
  { pattern: /\bsprouts\b/i, chainId: 'sprouts' },
  { pattern: /\btrader\s*joe'?s\b/i, chainId: 'traderjoes' },
  { pattern: /\bfresh\s*market\b/i, chainId: 'freshmarket' },
];

/** "3.49", "$3.49", "3.49 T", "3.49-" (negative/refund), "3.49 F" */
const TRAILING_PRICE = /\$?(-?\d{1,4}\.\d{2})\s*-?\s*(?:[A-Z]{1,2})?\s*$/;

/** "2 @ 1.99" or "2 @ $1.99" or "2 FOR 3.98" */
const MULTI_QTY = /(?:^|\s)(\d{1,3})\s*(?:@|for)\s*\$?(\d{1,4}\.\d{2})/i;

/** "2.13 lb @ $0.58/lb" */
const WEIGHTED = /(\d+\.?\d*)\s*(lb|lbs|kg|oz|g)\b\s*@\s*\$?(\d+\.\d{2})\s*\/\s*(lb|lbs|kg|oz|g)/i;

function toCents(value: string): number {
  return Math.round(Number.parseFloat(value) * 100);
}

/** Strips leading item codes and trailing tax/department flags. */
function cleanDescription(text: string): string {
  return text
    // Leading UPC or PLU codes: "0001111041700 MILK"
    .replace(/^\s*\d{6,14}\s+/, '')
    // Leading department numbers: "07 MILK"
    .replace(/^\s*\d{1,3}\s+(?=[A-Za-z])/, '')
    // Trailing single-letter tax flags and codes.
    .replace(/\s+[A-Z]{1,2}\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** True when the line is a header, footer, total or other non-item noise. */
function isNonItem(line: string): boolean {
  if (NON_ITEM.test(line)) return true;
  // A line with no letters at all is a divider or a barcode.
  if (!/[A-Za-z]/.test(line)) return true;
  return false;
}

/**
 * Parses one receipt line.
 *
 * Returns null when the line has no readable price, which the caller collects
 * as `unparsed` rather than discarding.
 */
export function parseReceiptLine(raw: string): ReceiptLine | null {
  const line = raw.replace(/\t+/g, '  ').trimEnd();
  if (line.trim().length === 0 || isNonItem(line)) return null;

  const priceMatch = line.match(TRAILING_PRICE);
  if (!priceMatch) return null;

  const totalCents = toCents(priceMatch[1]);
  // Refunds and zero lines are real but not purchases we can price from.
  if (totalCents <= 0) return null;

  const beforePrice = line.slice(0, priceMatch.index ?? line.length);

  const weighted = beforePrice.match(WEIGHTED);
  if (weighted) {
    return {
      description: cleanDescription(beforePrice.replace(WEIGHTED, ' ')),
      totalCents,
      quantity: 1,
      weight: {
        amount: Number.parseFloat(weighted[1]),
        unit: weighted[2].toLowerCase(),
        perUnitCents: toCents(weighted[3]),
      },
      raw: line.trim(),
    };
  }

  const multi = beforePrice.match(MULTI_QTY);
  if (multi) {
    const quantity = Number.parseInt(multi[1], 10);
    if (quantity >= 1 && quantity <= 99) {
      return {
        description: cleanDescription(beforePrice.replace(MULTI_QTY, ' ')),
        totalCents,
        quantity,
        raw: line.trim(),
      };
    }
  }

  const description = cleanDescription(beforePrice);
  // A price with no description is a total or a fragment, not an item.
  if (description.length < 2) return null;

  return { description, totalCents, quantity: 1, raw: line.trim() };
}

/** Finds the receipt's stated total, used to check our parse adds up. */
function findStatedTotal(text: string): number | null {
  // Prefer the LAST total-looking line: receipts often print subtotal first.
  const matches = [...text.matchAll(/^\s*(?:order\s+)?total\b[^\d\n]*\$?(\d{1,4}\.\d{2})/gim)];
  const last = matches[matches.length - 1];
  return last ? toCents(last[1]) : null;
}

function detectStore(text: string): string | null {
  const header = text.split(/\n/).slice(0, 12).join(' ');
  for (const signature of STORE_SIGNATURES) {
    if (signature.pattern.test(header)) return signature.chainId;
  }
  return null;
}

export function parseReceipt(text: string): ParsedReceipt {
  const lines: ReceiptLine[] = [];
  const unparsed: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim().length === 0) continue;
    if (isNonItem(raw)) continue;

    const parsed = parseReceiptLine(raw);
    if (parsed) lines.push(parsed);
    // Only flag lines that plausibly WERE items: they have letters and digits.
    else if (/[A-Za-z]/.test(raw) && /\d/.test(raw)) unparsed.push(raw.trim());
  }

  return {
    lines,
    unparsed,
    statedTotalCents: findStatedTotal(text),
    detectedStore: detectStore(text),
  };
}

/**
 * Compares our parsed sum against the receipt's own total.
 *
 * Tax means the two rarely match exactly, so this reports the gap rather than
 * asserting correctness. A large gap means lines were missed and the user
 * should look before saving.
 */
export function reconcile(receipt: ParsedReceipt): {
  parsedTotalCents: number;
  differenceCents: number | null;
  looksComplete: boolean;
} {
  const parsedTotalCents = receipt.lines.reduce((sum, line) => sum + line.totalCents, 0);
  if (receipt.statedTotalCents == null) {
    return { parsedTotalCents, differenceCents: null, looksComplete: receipt.unparsed.length === 0 };
  }
  const differenceCents = receipt.statedTotalCents - parsedTotalCents;
  // Within 12% covers sales tax and bag fees without hiding a missed line.
  const looksComplete = Math.abs(differenceCents) <= Math.round(receipt.statedTotalCents * 0.12);
  return { parsedTotalCents, differenceCents, looksComplete };
}
