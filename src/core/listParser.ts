/**
 * Parses a typed or pasted shopping list.
 *
 * People write lists the way they think, not the way a database wants them:
 * "2 milk", "milk x2", "- 3 lb bananas", "2x eggs". This turns each line into a
 * search query plus a quantity, and is deliberately conservative: when a leading
 * number could plausibly be part of the item's name rather than a count, it is
 * left in the query rather than silently eaten.
 */

export interface ParsedListLine {
  /** What to search the catalog for. */
  query: string;
  /** How many packs. Defaults to 1. */
  quantity: number;
  /** The original text, so the UI can report what did not match. */
  raw: string;
}

/** Bullets, numbering and checkbox marks people paste in from notes apps. */
const LEADING_NOISE = /^\s*(?:[-*•·>]+|\[\s*[xX ]?\s*\]|\d+[.)])\s*/;

/** Words that add nothing to a catalog match. */
const FILLER = /\b(?:of|some|a|an|the|please|pls)\b/gi;

/**
 * A leading number is only a quantity when it is NOT immediately followed by a
 * unit. "2 milk" is two milks; "2 lb bananas" is one bag of 2 lb bananas, and
 * "3.5 oz chocolate" is one bar. Getting this backwards would silently multiply
 * someone's basket.
 */
const UNIT_WORDS =
  /^(?:oz|ounce|ounces|lb|lbs|pound|pounds|g|kg|gram|grams|ml|l|liter|liters|litre|litres|gal|gallon|gallons|qt|quart|quarts|pt|pint|pints|ct|count|pk|pack|dozen|fl)\b/i;

export function parseListLine(raw: string): ParsedListLine | null {
  const trimmed = raw.replace(LEADING_NOISE, '').trim();
  if (trimmed.length === 0) return null;

  let quantity = 1;
  let text = trimmed;

  // Trailing form: "milk x2", "eggs ×3", "bread (2)"
  const trailing = text.match(/^(.*?)\s*(?:[x×]\s*(\d{1,2})|\((\d{1,2})\))\s*$/i);
  if (trailing) {
    const found = Number.parseInt(trailing[2] ?? trailing[3] ?? '1', 10);
    if (found >= 1 && found <= 99) {
      quantity = found;
      text = trailing[1].trim();
    }
  } else {
    // Leading form: "2 milk", "2x milk". Not "2 lb bananas".
    const leading = text.match(/^(\d{1,2})\s*[x×]?\s+(.*)$/i);
    if (leading && !UNIT_WORDS.test(leading[2])) {
      const found = Number.parseInt(leading[1], 10);
      if (found >= 1 && found <= 99) {
        quantity = found;
        text = leading[2].trim();
      }
    }
  }

  const query = text.replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  if (query.length === 0) return null;

  return { query, quantity, raw: trimmed };
}

/** Splits a pasted block into lines, tolerating commas as separators too. */
export function parseList(text: string): ParsedListLine[] {
  return text
    .split(/[\n\r]+/)
    .flatMap((line) => (line.includes(',') && !/\d/.test(line) ? line.split(',') : [line]))
    .map(parseListLine)
    .filter((line): line is ParsedListLine => line != null);
}
