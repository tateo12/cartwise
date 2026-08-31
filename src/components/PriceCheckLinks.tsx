import { ExternalLink } from 'lucide-react';
import { allStoreLinks, storeLinkFor } from '@/data/storeLinks';

/**
 * "Check the real price yourself" links.
 *
 * Every price Cartwise shows is either seeded, scraped, or off your receipt.
 * These links are the escape hatch to ground truth: they open the retailer's own
 * search page for the item, where you see their current price with their
 * promotions applied.
 *
 * This is the only route that reaches Walmart and Costco at all. Both block
 * automated reads outright, so no API or scraper will ever price them here. Your
 * browser, however, is a perfectly welcome visitor.
 */
export function PriceCheckLinks({
  query,
  chainIds,
  emphasise,
}: {
  /** What to search for, usually the Item name. */
  query: string;
  /** Restrict to these chains. Omit for all. */
  chainIds?: string[];
  /** Chains to pull to the front and highlight, e.g. ones we cannot price. */
  emphasise?: string[];
}) {
  const requested = chainIds
    ? chainIds.flatMap((chainId) => {
        const link = storeLinkFor(chainId);
        return link ? [{ chainId, ...link }] : [];
      })
    : allStoreLinks();

  const links = requested
    .slice()
    .sort((a, b) => {
      const aRank = emphasise?.includes(a.chainId) ? 0 : 1;
      const bRank = emphasise?.includes(b.chainId) ? 0 : 1;
      return aRank - bRank || a.label.localeCompare(b.label);
    });

  if (links.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-1.5">
      {links.map((link) => {
        const highlighted = emphasise?.includes(link.chainId);
        return (
          <li key={link.chainId}>
            <a
              href={link.url(query)}
              target="_blank"
              rel="noreferrer noopener"
              title={
                link.instacart
                  ? 'Opens an Instacart-powered storefront. Prices there may include markup rather than the shelf price.'
                  : `Opens ${link.label}'s own search page for “${query}”`
              }
              className={
                highlighted
                  ? 'inline-flex items-center gap-1 rounded-lg border border-accent/40 bg-accent/10 px-2 py-1 text-[11px] font-medium text-accent transition hover:bg-accent/15'
                  : 'inline-flex items-center gap-1 rounded-lg border border-line bg-raised/50 px-2 py-1 text-[11px] font-medium text-zinc-400 transition hover:border-line-bright hover:text-zinc-200'
              }
            >
              {link.label}
              {link.instacart && <span className="text-[9px] text-zinc-500">$$</span>}
              <ExternalLink className="size-2.5" aria-hidden />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
