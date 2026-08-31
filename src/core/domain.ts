/**
 * Cartwise domain types. Vocabulary is defined in /CONTEXT.md — keep them in sync.
 *
 * The load-bearing distinction: an **Offer** is the only thing that is literally
 * true (this price, this Store, this moment). A **Product** is one chain's SKU.
 * An **Item** is the cross-store equivalence class the user actually shops for.
 */

/** What kind of magnitude a size is measured in. Never compare across dimensions. */
export type Dimension = 'mass' | 'volume' | 'count';

/** Where a price came from. Surfaced in the UI on every number — see ADR 0001. */
export type Provenance = 'live' | 'seed' | 'user';

/**
 * How much we trust that a Product belongs to an Item.
 * `pinned` outranks everything: it is the user's own correction.
 */
export type MatchConfidence = 'pinned' | 'high' | 'medium' | 'unmatched';

/** Kroger's API reports this per location; seeded providers cannot know it. */
export type StockLevel = 'high' | 'low' | 'out_of_stock' | 'not_carried' | 'unknown';

/** A retail company whose prices are sourced as a unit. Adapters target Chains. */
export interface Chain {
  id: string;
  name: string;
  /** Store-brand label used when this chain has no name-brand equivalent. */
  ownBrand: string;
  /** Which PriceProvider services this chain. */
  provider: 'kroger' | 'target' | 'seed';
}

/** One physical location. Prices belong to Stores, not Chains. */
export interface Store {
  id: string;
  chainId: string;
  /** Consumer-facing storefront name — "Smith's" is a banner of the Kroger chain. */
  banner: string;
  label: string;
  address: string;
  /** Kroger API locationId, when this store is priceable live. */
  krogerLocationId?: string;
  /** Target store id (`pricing_store_id`), when this store is priceable live. */
  targetStoreId?: string;
  /** One-way drive minutes from home. Powers the "is the extra stop worth it" math. */
  driveMinutes: number;
}

/** The cross-store equivalence class. A Basket is a list of these. */
export interface Item {
  id: string;
  name: string;
  category: string;
  dimension: Dimension;
  /** Typical purchase size in base units (oz / fl oz / ct), for unit-price display. */
  referenceSize: number;
  /**
   * Set when every chain carries the identical barcoded product, which makes all
   * its matches `high` confidence. Absent means this Item is satisfied by store
   * brands, which can only ever match at `medium`.
   */
  nameBrand?: { brand: string; upc: string };
}

/** One chain-specific SKU that maps into an Item. */
export interface Product {
  id: string;
  itemId: string;
  chainId: string;
  brand: string;
  name: string;
  /** Human label as printed on the shelf, e.g. "2 x 1 gal". */
  sizeLabel: string;
  /** Base units in ONE retail unit (before packMultiple). */
  sizeBase: number;
  dimension: Dimension;
  /** How many retail units come in the pack. Costco's 2-gallon milk is 2. */
  packMultiple: number;
  upc?: string;
  confidence: MatchConfidence;
}

/** A price for one Product at one Store at one moment. */
export interface Offer {
  productId: string;
  storeId: string;
  /** Shelf price for the pack, in cents. Integer cents — never float dollars. */
  priceCents: number;
  /** Non-null when the shelf price is a temporary promo. */
  regularPriceCents: number | null;
  stock: StockLevel;
  provenance: Provenance;
  /** ISO timestamp. Staleness is a first-class concern for live sources. */
  fetchedAt: string;
  /**
   * The retailer's own barcode for the product this Offer priced, when a live
   * fetch identified one.
   *
   * Required for cart push: Kroger's `/v1/cart/add` takes a UPC, and our seeded
   * store-brand products have none. So a cart can only be filled with items a
   * live refresh has actually resolved.
   */
  sourceUpc?: string;
}

/** A line of the user's shopping intent: an Item and how many they want. */
export interface BasketLine {
  itemId: string;
  quantity: number;
}

/** One Item resolved to a concrete Product/Offer at a concrete Store. */
export interface Assignment {
  itemId: string;
  storeId: string;
  product: Product;
  offer: Offer;
  quantity: number;
  /** quantity x pack price, in cents. */
  lineTotalCents: number;
  /** True when this Store was NOT the user's preferred store for the trip and
   *  the Item had to be sourced here because the preferred store doesn't carry it. */
  forced: boolean;
}

/** A concrete way to buy the whole Basket. A one-stop Plan is still a Plan. */
export interface Plan {
  /**
   * The Store the user intends to shop, when this Plan is anchored on one.
   * Null for an unanchored (cherry-pick) Plan. Exposed so the UI never has to
   * reverse-engineer which Store the headline is really about.
   */
  anchorId: string | null;
  /** Stores visited, in ascending drive-minute order. */
  storeIds: string[];
  assignments: Assignment[];
  totalCents: number;
  /** Stops that exist only because a primary store doesn't carry something. */
  forcedStopIds: string[];
  /** Items no selected store carries at all. Plan is incomplete if non-empty. */
  unavailableItemIds: string[];
  driveMinutes: number;
}
