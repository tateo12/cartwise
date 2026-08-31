import type { Dimension } from './domain';

/**
 * Unit normalization. Every size collapses to ONE base unit per dimension so
 * that unit prices are comparable:  mass -> oz,  volume -> fl oz,  count -> ct.
 *
 * Cross-dimension comparison is deliberately impossible: there is no honest
 * answer to "is 16 oz of cheese cheaper than 12 fl oz of milk".
 */

const MASS_TO_OZ: Record<string, number> = {
  oz: 1, ounce: 1, ounces: 1,
  lb: 16, lbs: 16, pound: 16, pounds: 16,
  g: 0.0352739619, gram: 0.0352739619, grams: 0.0352739619,
  kg: 35.2739619, kilogram: 35.2739619, kilograms: 35.2739619,
};

const VOLUME_TO_FLOZ: Record<string, number> = {
  'fl oz': 1, floz: 1, 'fluid ounce': 1, 'fluid ounces': 1,
  pt: 16, pint: 16, pints: 16,
  qt: 32, quart: 32, quarts: 32,
  gal: 128, gallon: 128, gallons: 128,
  ml: 0.0338140227, milliliter: 0.0338140227, milliliters: 0.0338140227,
  l: 33.8140227, liter: 33.8140227, liters: 33.8140227,
};

const COUNT_TO_CT: Record<string, number> = {
  ct: 1, count: 1, each: 1, ea: 1, pk: 1, pack: 1, roll: 1, rolls: 1, dozen: 12,
};

export const BASE_UNIT: Record<Dimension, string> = {
  mass: 'oz',
  volume: 'fl oz',
  count: 'ct',
};

export interface ParsedSize {
  /** Base units in one retail unit. */
  sizeBase: number;
  /** Retail units per pack — "2 x 1 gal" is 2. */
  packMultiple: number;
  dimension: Dimension;
}

/**
 * Parses shelf-style size labels: "1 gal", "18 ct", "2 x 1 gal", "25 fl oz",
 * "3 lb", "12 x 12 fl oz". Returns null when nothing parseable is found, which
 * the caller must treat as "no unit price available" rather than guessing.
 */
export function parseSize(label: string): ParsedSize | null {
  const text = label.toLowerCase().replace(/[\u00d7\u2715]/g, 'x').trim();

  let packMultiple = 1;
  let rest = text;

  // Leading pack multiple: "2 x 1 gal", "12x12 fl oz", "4 pk 16 oz".
  const leadingPack = rest.match(/^(\d+)\s*(?:x|pk|pack)\s*(.+)$/);
  if (leadingPack) {
    packMultiple *= Number.parseInt(leadingPack[1], 10);
    rest = leadingPack[2].trim();
  }

  // Trailing pack multiple: "16.9 fl oz 6 pk". Only `pk`/`pack` qualify — `ct`
  // is a unit in its own right, so treating a trailing "18 ct" as a pack count
  // would turn a carton of eggs into 18 packs of nothing.
  const trailingPack = rest.match(/^(.+?)\s+(\d+)\s*(?:pk|pack)$/);
  if (trailingPack) {
    packMultiple *= Number.parseInt(trailingPack[2], 10);
    rest = trailingPack[1].trim();
  }

  const parsed = parseAmount(rest);
  if (!parsed) return null;

  const resolved = resolveUnit(parsed.unit);
  if (!resolved) return null;

  return {
    sizeBase: parsed.amount * resolved.factor,
    packMultiple,
    dimension: resolved.dimension,
  };
}

/**
 * Splits "1 1/2 lb" / "3/4 cup" / "20.25 oz" into a numeric amount and a unit.
 *
 * Mixed fractions are handled explicitly rather than approximately: a previous
 * version matched only the fractional part and read "1 1/2 lb" as half a pound,
 * discarding the whole number entirely.
 */
function parseAmount(text: string): { amount: number; unit: string } | null {
  const mixed = text.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)\s*([a-z\s]+)$/);
  if (mixed) {
    const denominator = Number.parseInt(mixed[3], 10);
    if (denominator === 0) return null;
    return {
      amount: Number.parseInt(mixed[1], 10) + Number.parseInt(mixed[2], 10) / denominator,
      unit: normalizeUnit(mixed[4]),
    };
  }

  const fraction = text.match(/^(\d+)\s*\/\s*(\d+)\s*([a-z\s]+)$/);
  if (fraction) {
    const denominator = Number.parseInt(fraction[2], 10);
    if (denominator === 0) return null;
    return { amount: Number.parseInt(fraction[1], 10) / denominator, unit: normalizeUnit(fraction[3]) };
  }

  const decimal = text.match(/^(\d+(?:\.\d+)?)\s*([a-z\s]+)$/);
  if (decimal) return { amount: Number.parseFloat(decimal[1]), unit: normalizeUnit(decimal[2]) };

  return null;
}

function normalizeUnit(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

function resolveUnit(unit: string): { factor: number; dimension: Dimension } | null {
  // Check volume before mass so "fl oz" never falls through to bare "oz".
  if (unit in VOLUME_TO_FLOZ) return { factor: VOLUME_TO_FLOZ[unit], dimension: 'volume' };
  if (unit in MASS_TO_OZ) return { factor: MASS_TO_OZ[unit], dimension: 'mass' };
  if (unit in COUNT_TO_CT) return { factor: COUNT_TO_CT[unit], dimension: 'count' };
  return null;
}

/**
 * Cents per base unit for a whole pack. This is the number that catches
 * shrinkflation: a $8 bulk pack routinely beats a $3 small box.
 */
export function unitPriceCents(priceCents: number, sizeBase: number, packMultiple: number): number | null {
  const totalBase = sizeBase * packMultiple;
  if (!Number.isFinite(totalBase) || totalBase <= 0) return null;
  return priceCents / totalBase;
}

/** Formats a unit price for display, choosing a readable scale per dimension. */
export function formatUnitPrice(centsPerBase: number | null, dimension: Dimension): string {
  if (centsPerBase == null) return '—';
  const unit = BASE_UNIT[dimension];
  // Fractions of a cent per ounce are unreadable, so small values scale up to
  // the unit people actually shop in: pounds for weight, quarts for liquid.
  if (dimension === 'count') return `${formatMoney(centsPerBase)}/${unit}`;
  if (centsPerBase < 5) {
    return dimension === 'mass'
      ? `${formatMoney(centsPerBase * 16)}/lb`
      : `${formatMoney(centsPerBase * 32)}/qt`;
  }
  return `${formatMoney(centsPerBase)}/${unit}`;
}

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
