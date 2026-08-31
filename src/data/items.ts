import type { Dimension } from '@/core/domain';

/**
 * The seeded Item catalog.
 *
 * `baseCents` is the price of `sizeLabel` at the Kroger baseline; every other
 * chain is derived from it per-unit (see core/pricing.ts), which is what lets
 * Costco be expensive per pack and cheap per ounce at the same time.
 *
 * Coverage is deliberately uneven, because real selection is uneven:
 *  - `costco` / `tj` are OPT-IN — those chains carry a narrow SKU range, so an
 *    Item without the key genuinely is not carried there.
 *  - `notCarried` marks gaps at the wide-range chains.
 * This is what exercises the forced-stop path in the optimizer.
 */
export interface ItemSpec {
  id: string;
  name: string;
  category: string;
  dimension: Dimension;
  /** Standard pack as printed on the shelf at most chains. */
  sizeLabel: string;
  /** Kroger-baseline price for `sizeLabel`, in cents. */
  baseCents: number;
  /** Present when all chains stock the identical barcoded product -> `high` match. */
  nameBrand?: { brand: string; upc: string };
  /** Costco's bulk pack. Absent = Costco does not carry this Item. */
  costco?: { sizeLabel: string };
  /** Trader Joe's carries this. Absent = not carried. */
  tj?: true;
  /** Chain ids that do not stock this Item. */
  notCarried?: string[];
}

export const ITEMS: ItemSpec[] = [
  // ── Dairy & Eggs ────────────────────────────────────────────────────────
  { id: 'whole-milk', name: 'Whole milk', category: 'Dairy & Eggs', dimension: 'volume', sizeLabel: '1 gal', baseCents: 329, costco: { sizeLabel: '2 x 1 gal' }, tj: true },
  { id: 'large-eggs', name: 'Large eggs', category: 'Dairy & Eggs', dimension: 'count', sizeLabel: '18 ct', baseCents: 449, costco: { sizeLabel: '24 ct' }, tj: true },
  { id: 'cheddar-block', name: 'Sharp cheddar block', category: 'Dairy & Eggs', dimension: 'mass', sizeLabel: '8 oz', baseCents: 299, costco: { sizeLabel: '32 oz' }, tj: true },
  { id: 'greek-yogurt', name: 'Plain Greek yogurt', category: 'Dairy & Eggs', dimension: 'mass', sizeLabel: '32 oz', baseCents: 549, costco: { sizeLabel: '48 oz' }, tj: true },
  { id: 'butter', name: 'Unsalted butter', category: 'Dairy & Eggs', dimension: 'mass', sizeLabel: '16 oz', baseCents: 499, costco: { sizeLabel: '4 x 16 oz' }, tj: true },
  { id: 'fairlife-milk', name: 'Fairlife 2% ultra-filtered milk', category: 'Dairy & Eggs', dimension: 'volume', sizeLabel: '52 fl oz', baseCents: 469, nameBrand: { brand: 'Fairlife', upc: '081268001078' }, notCarried: ['winco'] },
  { id: 'cream-cheese', name: 'Cream cheese', category: 'Dairy & Eggs', dimension: 'mass', sizeLabel: '8 oz', baseCents: 279 },
  { id: 'shredded-mozz', name: 'Shredded mozzarella', category: 'Dairy & Eggs', dimension: 'mass', sizeLabel: '8 oz', baseCents: 289, costco: { sizeLabel: '32 oz' } },

  // ── Produce ─────────────────────────────────────────────────────────────
  { id: 'bananas', name: 'Bananas', category: 'Produce', dimension: 'mass', sizeLabel: '3 lb', baseCents: 177, costco: { sizeLabel: '3 lb' }, tj: true },
  { id: 'hass-avocado', name: 'Hass avocados', category: 'Produce', dimension: 'count', sizeLabel: '4 ct', baseCents: 396, costco: { sizeLabel: '6 ct' }, tj: true },
  { id: 'baby-spinach', name: 'Baby spinach', category: 'Produce', dimension: 'mass', sizeLabel: '10 oz', baseCents: 349, costco: { sizeLabel: '16 oz' }, tj: true },
  { id: 'roma-tomatoes', name: 'Roma tomatoes', category: 'Produce', dimension: 'mass', sizeLabel: '2 lb', baseCents: 258 },
  { id: 'gala-apples', name: 'Gala apples', category: 'Produce', dimension: 'mass', sizeLabel: '3 lb', baseCents: 447, costco: { sizeLabel: '5 lb' } },
  { id: 'yellow-onions', name: 'Yellow onions', category: 'Produce', dimension: 'mass', sizeLabel: '3 lb', baseCents: 297 },
  { id: 'russet-potatoes', name: 'Russet potatoes', category: 'Produce', dimension: 'mass', sizeLabel: '5 lb', baseCents: 449, costco: { sizeLabel: '10 lb' } },
  { id: 'strawberries', name: 'Strawberries', category: 'Produce', dimension: 'mass', sizeLabel: '16 oz', baseCents: 399, costco: { sizeLabel: '2 lb' } },
  { id: 'broccoli-crowns', name: 'Broccoli crowns', category: 'Produce', dimension: 'mass', sizeLabel: '1 lb', baseCents: 199 },
  { id: 'baby-carrots', name: 'Baby carrots', category: 'Produce', dimension: 'mass', sizeLabel: '16 oz', baseCents: 179, costco: { sizeLabel: '5 lb' } },

  // ── Meat & Seafood ──────────────────────────────────────────────────────
  { id: 'chicken-breast', name: 'Boneless chicken breast', category: 'Meat & Seafood', dimension: 'mass', sizeLabel: '3 lb', baseCents: 1197, costco: { sizeLabel: '6 lb' } },
  { id: 'ground-beef-85', name: '85/15 ground beef', category: 'Meat & Seafood', dimension: 'mass', sizeLabel: '1 lb', baseCents: 599, costco: { sizeLabel: '4 lb' } },
  { id: 'bacon', name: 'Thick-cut bacon', category: 'Meat & Seafood', dimension: 'mass', sizeLabel: '16 oz', baseCents: 699, costco: { sizeLabel: '4 x 16 oz' } },
  { id: 'salmon-fillet', name: 'Atlantic salmon fillet', category: 'Meat & Seafood', dimension: 'mass', sizeLabel: '1 lb', baseCents: 1199, costco: { sizeLabel: '3 lb' }, notCarried: ['walmart'] },
  { id: 'ground-turkey', name: 'Ground turkey 93/7', category: 'Meat & Seafood', dimension: 'mass', sizeLabel: '16 oz', baseCents: 549 },
  { id: 'pork-chops', name: 'Boneless pork chops', category: 'Meat & Seafood', dimension: 'mass', sizeLabel: '2 lb', baseCents: 899 },

  // ── Pantry ──────────────────────────────────────────────────────────────
  { id: 'olive-oil', name: 'Extra virgin olive oil', category: 'Pantry', dimension: 'volume', sizeLabel: '25 fl oz', baseCents: 1299, costco: { sizeLabel: '2 l' }, tj: true, notCarried: ['winco'] },
  { id: 'barilla-penne', name: 'Barilla penne', category: 'Pantry', dimension: 'mass', sizeLabel: '16 oz', baseCents: 199, nameBrand: { brand: 'Barilla', upc: '076808280456' } },
  { id: 'white-rice', name: 'Long grain white rice', category: 'Pantry', dimension: 'mass', sizeLabel: '5 lb', baseCents: 549, costco: { sizeLabel: '25 lb' } },
  { id: 'black-beans', name: 'Black beans, canned', category: 'Pantry', dimension: 'mass', sizeLabel: '15 oz', baseCents: 119 },
  { id: 'peanut-butter', name: 'Creamy peanut butter', category: 'Pantry', dimension: 'mass', sizeLabel: '16 oz', baseCents: 329, costco: { sizeLabel: '2 x 28 oz' } },
  { id: 'heinz-ketchup', name: 'Heinz ketchup', category: 'Pantry', dimension: 'volume', sizeLabel: '32 fl oz', baseCents: 429, nameBrand: { brand: 'Heinz', upc: '013000006101' } },
  { id: 'flour', name: 'All-purpose flour', category: 'Pantry', dimension: 'mass', sizeLabel: '5 lb', baseCents: 419, costco: { sizeLabel: '25 lb' } },
  { id: 'sugar', name: 'Granulated sugar', category: 'Pantry', dimension: 'mass', sizeLabel: '4 lb', baseCents: 379, costco: { sizeLabel: '25 lb' } },
  { id: 'cheerios', name: 'Cheerios', category: 'Pantry', dimension: 'mass', sizeLabel: '18 oz', baseCents: 549, nameBrand: { brand: 'General Mills', upc: '016000275287' }, costco: { sizeLabel: '2 x 20.25 oz' } },
  { id: 'marinara', name: 'Marinara sauce', category: 'Pantry', dimension: 'volume', sizeLabel: '24 fl oz', baseCents: 289, tj: true },
  { id: 'chicken-broth', name: 'Chicken broth', category: 'Pantry', dimension: 'volume', sizeLabel: '32 fl oz', baseCents: 249 },
  { id: 'canned-tuna', name: 'Chunk light tuna', category: 'Pantry', dimension: 'mass', sizeLabel: '5 oz', baseCents: 129, costco: { sizeLabel: '8 x 5 oz' } },
  { id: 'honey', name: 'Honey', category: 'Pantry', dimension: 'mass', sizeLabel: '12 oz', baseCents: 549, costco: { sizeLabel: '40 oz' }, tj: true },
  { id: 'maple-syrup', name: 'Pure maple syrup', category: 'Pantry', dimension: 'volume', sizeLabel: '8 fl oz', baseCents: 799, tj: true, notCarried: ['walmart'] },

  // ── Bakery ──────────────────────────────────────────────────────────────
  { id: 'sandwich-bread', name: 'Whole wheat sandwich bread', category: 'Bakery', dimension: 'mass', sizeLabel: '20 oz', baseCents: 349, tj: true },
  { id: 'bagels', name: 'Plain bagels', category: 'Bakery', dimension: 'count', sizeLabel: '6 ct', baseCents: 349, tj: true },
  { id: 'tortillas', name: 'Flour tortillas', category: 'Bakery', dimension: 'count', sizeLabel: '10 ct', baseCents: 329, costco: { sizeLabel: '20 ct' } },

  // ── Frozen ──────────────────────────────────────────────────────────────
  { id: 'frozen-blueberries', name: 'Frozen blueberries', category: 'Frozen', dimension: 'mass', sizeLabel: '16 oz', baseCents: 449, costco: { sizeLabel: '4 lb' }, tj: true },
  { id: 'frozen-peas', name: 'Frozen peas', category: 'Frozen', dimension: 'mass', sizeLabel: '16 oz', baseCents: 179, tj: true },
  { id: 'ice-cream', name: 'Vanilla ice cream', category: 'Frozen', dimension: 'volume', sizeLabel: '48 fl oz', baseCents: 549 },
  { id: 'frozen-pizza', name: 'Pepperoni frozen pizza', category: 'Frozen', dimension: 'mass', sizeLabel: '22 oz', baseCents: 699, notCarried: ['sprouts'] },

  // ── Beverages ───────────────────────────────────────────────────────────
  { id: 'orange-juice', name: 'Orange juice', category: 'Beverages', dimension: 'volume', sizeLabel: '52 fl oz', baseCents: 449 },
  { id: 'ground-coffee', name: 'Ground coffee, medium roast', category: 'Beverages', dimension: 'mass', sizeLabel: '12 oz', baseCents: 899, costco: { sizeLabel: '40 oz' }, tj: true },
  { id: 'lacroix', name: 'LaCroix sparkling water', category: 'Beverages', dimension: 'volume', sizeLabel: '12 x 12 fl oz', baseCents: 549, nameBrand: { brand: 'LaCroix', upc: '012993416034' }, costco: { sizeLabel: '24 x 12 fl oz' }, notCarried: ['winco'] },
  { id: 'green-tea', name: 'Green tea bags', category: 'Beverages', dimension: 'count', sizeLabel: '40 ct', baseCents: 419, tj: true },

  // ── Snacks ──────────────────────────────────────────────────────────────
  { id: 'tortilla-chips', name: 'Tortilla chips', category: 'Snacks', dimension: 'mass', sizeLabel: '13 oz', baseCents: 399, tj: true },
  { id: 'almonds', name: 'Raw almonds', category: 'Snacks', dimension: 'mass', sizeLabel: '16 oz', baseCents: 799, costco: { sizeLabel: '48 oz' }, tj: true },
  { id: 'dark-chocolate', name: 'Dark chocolate bar', category: 'Snacks', dimension: 'mass', sizeLabel: '3.5 oz', baseCents: 279, tj: true, notCarried: ['winco'] },
  { id: 'popcorn-kernels', name: 'Popcorn kernels', category: 'Snacks', dimension: 'mass', sizeLabel: '30 oz', baseCents: 399 },

  // ── Household ───────────────────────────────────────────────────────────
  { id: 'paper-towels', name: 'Paper towels', category: 'Household', dimension: 'count', sizeLabel: '6 rolls', baseCents: 899, costco: { sizeLabel: '12 rolls' } },
  { id: 'toilet-paper', name: 'Toilet paper', category: 'Household', dimension: 'count', sizeLabel: '12 rolls', baseCents: 1099, costco: { sizeLabel: '30 rolls' } },
  { id: 'dish-soap', name: 'Dish soap', category: 'Household', dimension: 'volume', sizeLabel: '22 fl oz', baseCents: 379 },
  { id: 'laundry-detergent', name: 'Laundry detergent', category: 'Household', dimension: 'volume', sizeLabel: '92 fl oz', baseCents: 1199, costco: { sizeLabel: '196 fl oz' } },
  { id: 'trash-bags', name: 'Kitchen trash bags', category: 'Household', dimension: 'count', sizeLabel: '40 ct', baseCents: 899, costco: { sizeLabel: '200 ct' } },

  // ── Personal Care ───────────────────────────────────────────────────────
  { id: 'toothpaste', name: 'Toothpaste', category: 'Personal Care', dimension: 'mass', sizeLabel: '5.7 oz', baseCents: 399 },
  { id: 'shampoo', name: 'Shampoo', category: 'Personal Care', dimension: 'volume', sizeLabel: '12 fl oz', baseCents: 599, notCarried: ['sprouts'] },
];

export const itemById = new Map(ITEMS.map((i) => [i.id, i]));

export const CATEGORIES = [...new Set(ITEMS.map((i) => i.category))];

/** The Basket the dashboard opens with — a plausible weekly shop. */
export const DEFAULT_BASKET: { itemId: string; quantity: number }[] = [
  { itemId: 'whole-milk', quantity: 1 },
  { itemId: 'large-eggs', quantity: 1 },
  { itemId: 'chicken-breast', quantity: 1 },
  { itemId: 'sandwich-bread', quantity: 1 },
  { itemId: 'bananas', quantity: 1 },
  { itemId: 'cheddar-block', quantity: 2 },
  { itemId: 'ground-coffee', quantity: 1 },
  { itemId: 'olive-oil', quantity: 1 },
  { itemId: 'baby-spinach', quantity: 1 },
  { itemId: 'greek-yogurt', quantity: 1 },
  { itemId: 'ground-beef-85', quantity: 2 },
  { itemId: 'marinara', quantity: 1 },
  // Name-brand lines: identical barcode everywhere, so these match at `high`
  // confidence and show the difference from store-brand `medium` matches.
  { itemId: 'cheerios', quantity: 1 },
  { itemId: 'heinz-ketchup', quantity: 1 },
];
