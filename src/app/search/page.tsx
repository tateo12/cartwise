import Link from 'next/link';
import { buildSearchResults } from '@/server/search';
import { basket } from '@/db/queries';
import { AddToBasketButton } from '@/components/BasketControls';
import { ConfidenceBadge, EmptyState, Money, Panel, PanelHeader, ProductBrand, ProvenanceBadge, StockNote, VerdictBadge } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * Per-Item cheapest, across the user's selected stores.
 *
 * This is the search bar's answer and it is intentionally independent of the
 * basket: the dashboard optimizes a whole trip, this optimizes one product.
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? '').trim();
  const { results } = buildSearchResults(query);
  const quantities = new Map(basket().map((line) => [line.itemId, line.quantity]));

  if (!query) {
    return (
      <Panel>
        <EmptyState
          title="Search for anything you buy"
          body="Type an item in the bar above — milk, coffee, olive oil, paper towels — and Cartwise tells you which of your selected stores has it cheapest right now."
        />
      </Panel>
    );
  }

  if (results.length === 0) {
    return (
      <Panel>
        <EmptyState
          title={`Nothing matching “${query}”`}
          body="Try a broader term. The seeded catalog covers about 60 common grocery items across ten categories."
          cta={{ href: '/items', label: 'Browse all prices' }}
        />
      </Panel>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <p className="text-[13px] text-zinc-500">
        {results.length} {results.length === 1 ? 'match' : 'matches'} for{' '}
        <span className="font-medium text-zinc-300">&ldquo;{query}&rdquo;</span>
      </p>

      {results.map((entry) => (
        <Panel key={entry.item.id}>
          <PanelHeader
            title={entry.item.name}
            hint={`${entry.item.category} · standard pack ${entry.item.sizeLabel}`}
            action={<AddToBasketButton itemId={entry.item.id} currentQuantity={quantities.get(entry.item.id) ?? 0} />}
          />

          {entry.best ? (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line bg-accent/[0.04] px-5 py-3">
              <span className="eyebrow">Cheapest</span>
              <span className="text-[15px] font-semibold text-zinc-100">{entry.best.store.banner}</span>
              <span className="text-[15px] font-semibold text-accent tnum">
                <Money cents={entry.best.offer.priceCents} />
              </span>
              <ProvenanceBadge provenance={entry.best.offer.provenance} />
              <span className="text-[11px] text-zinc-500 tnum">{entry.best.unitPrice}</span>
              <VerdictBadge verdict={entry.best.deal.verdict} />
            </div>
          ) : (
            <p className="border-b border-line px-5 py-3 text-xs text-rose-300/80">
              None of your selected stores carry this.
            </p>
          )}

          <ul className="divide-y divide-line/70">
            {entry.quotes.map((quote) => (
              <li key={quote.store.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1">
                  <span className="text-zinc-200">{quote.store.banner}</span>
                  <span className="ml-2 text-[11px] text-zinc-500">
                    <ProductBrand brand={quote.product.brand} banner={quote.store.banner} /> &middot;{' '}
                    {quote.product.sizeLabel}
                  </span>
                </span>
                <ConfidenceBadge confidence={quote.product.confidence} />
                <ProvenanceBadge provenance={quote.offer.provenance} />
                <StockNote stock={quote.offer.stock} />
                <span className="w-20 text-right text-zinc-400 tnum">{quote.unitPrice}</span>
                <span className="w-20 text-right font-medium text-zinc-100 tnum">
                  <Money cents={quote.offer.priceCents} />
                </span>
                <span className="w-16 text-right text-[11px] tnum">
                  {quote.premiumCents === 0 ? (
                    <span className="font-semibold text-accent">best</span>
                  ) : (
                    <span className="text-zinc-500">
                      +<Money cents={quote.premiumCents} />
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>

          {entry.missingStores.length > 0 && (
            <p className="border-t border-line px-5 py-2.5 text-[11px] text-zinc-600">
              Not carried at {entry.missingStores.map((s) => s.banner).join(', ')}
            </p>
          )}

          <div className="border-t border-line px-5 py-2.5">
            <Link href={`/item/${entry.item.id}`} className="text-[11px] font-medium text-accent hover:text-emerald-300">
              Price history &amp; all matches →
            </Link>
          </div>
        </Panel>
      ))}
    </div>
  );
}
