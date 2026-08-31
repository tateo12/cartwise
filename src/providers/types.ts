import type { Offer, Product, Store } from '@/core/domain';

/**
 * The adapter seam. Every price source implements this, which is what lets a
 * seeded chain be swapped for a real API later without touching the optimizer
 * or a single component. See ADR 0003.
 */
export interface PriceProvider {
  id: 'kroger' | 'target' | 'seed';
  /** Human label for the provenance badge. */
  label: string;
  /** False when credentials/config are missing, so callers can fall back. */
  isAvailable(): boolean;
  /**
   * Fetches current Offers for the given Products at one Store.
   * Implementations must return an Offer only for Products they can actually
   * price — omitting one is meaningful (it becomes "not carried"), so returning
   * a guessed price instead is a correctness bug.
   */
  fetchOffers(store: Store, products: Product[]): Promise<Offer[]>;
  /**
   * Optional pre-flight check. Lets a caller distinguish "credentials are
   * wrong" from "the provider had nothing for these products" — two outcomes
   * that otherwise both surface as zero offers.
   */
  checkAuth?(): Promise<{ ok: boolean; reason?: string }>;
}
