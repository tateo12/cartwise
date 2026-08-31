import Link from 'next/link';
import { Bell } from 'lucide-react';
import { WatchToggle } from '@/components/WatchToggle';
import { EmptyState, Money, Panel, PanelHeader, ProvenanceBadge, VerdictBadge } from '@/components/ui';
import { buildOfferIndex, watches } from '@/db/queries';
import { quotesForItem } from '@/server/search';
import { buildBasketView } from '@/server/view';

export const dynamic = 'force-dynamic';

export default function AlertsPage() {
  const index = buildOfferIndex();
  const watched = watches();
  const entries = watched
    .map((watch) => ({ watch, quotes: quotesForItem(watch.itemId, index) }))
    .filter((e): e is { watch: typeof watched[number]; quotes: NonNullable<ReturnType<typeof quotesForItem>> } => e.quotes != null);

  const view = buildBasketView();
  const basketLows = view.rows.filter((row) => row.deal.verdict === 'real-low');
  const basketFakes = view.rows.filter((row) => row.deal.verdict === 'fake-sale');

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-zinc-100">Watchlist</h1>
        <p className="mt-1 text-[13px] text-zinc-500">
          A watched item alerts when it reaches a genuine low for that store — judged against its own 90-day price
          distribution, not against whatever the shelf tag claims.
        </p>
      </div>

      {/* Triggered right now, from the basket — the actionable part. */}
      {(basketLows.length > 0 || basketFakes.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {basketLows.length > 0 && (
            <Panel>
              <PanelHeader title="Buy now" hint="In your basket and at a real low" />
              <ul className="divide-y divide-line">
                {basketLows.map((row) => (
                  <li key={row.item.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-[13px]">
                    <Link href={`/item/${row.item.id}`} className="text-zinc-200 hover:text-accent">
                      {row.item.name}
                    </Link>
                    <span className="flex items-center gap-2">
                      <span className="text-[11px] text-zinc-500">{row.store.banner}</span>
                      <ProvenanceBadge provenance={row.assignment.offer.provenance} />
                      <span className="font-medium text-accent tnum">
                        <Money cents={row.assignment.offer.priceCents} />
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {basketFakes.length > 0 && (
            <Panel>
              <PanelHeader title="Don't be fooled" hint="Sale tag, but not actually cheap" />
              <ul className="divide-y divide-line">
                {basketFakes.map((row) => (
                  <li key={row.item.id} className="px-5 py-2.5 text-[13px]">
                    <div className="flex items-center justify-between gap-3">
                      <Link href={`/item/${row.item.id}`} className="text-zinc-200 hover:text-accent">
                        {row.item.name}
                      </Link>
                      <span className="flex items-center gap-2">
                        <ProvenanceBadge provenance={row.assignment.offer.provenance} />
                        <span className="font-medium text-zinc-300 tnum">
                          <Money cents={row.assignment.offer.priceCents} />
                        </span>
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-rose-300/70 tnum">
                      &ldquo;on sale&rdquo; at {row.store.banner}, but its 90-day median is{' '}
                      <Money cents={row.deal.medianCents} />
                    </p>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}

      <Panel>
        <PanelHeader title="Watched items" hint={`${entries.length} being tracked`} />
        {entries.length === 0 ? (
          <EmptyState
            title="Nothing on your watchlist"
            body="Open any item and hit Watch price. Cartwise will flag it when it hits a genuine low rather than a fake sale."
            cta={{ href: '/items', label: 'Browse prices' }}
          />
        ) : (
          <ul className="divide-y divide-line">
            {entries.map(({ watch, quotes }) => {
              const best = quotes.best;
              const target = watch.targetCents;
              const hitTarget = target != null && best != null && best.offer.priceCents <= target;
              return (
                <li key={watch.itemId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                  <span className="min-w-0 flex-1">
                    <Link href={`/item/${watch.itemId}`} className="text-[13px] font-medium text-zinc-100 hover:text-accent">
                      {quotes.item.name}
                    </Link>
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      {best ? (
                        <>
                          cheapest at {best.store.banner} &middot; 90-day low{' '}
                          <span className="tnum"><Money cents={best.deal.lowCents} /></span>
                        </>
                      ) : (
                        'not carried by your selected stores'
                      )}
                    </p>
                  </span>

                  {target != null && (
                    <span
                      className={
                        hitTarget
                          ? 'inline-flex items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent ring-1 ring-inset ring-accent/30'
                          : 'text-[11px] text-zinc-500 tnum'
                      }
                    >
                      {hitTarget && <Bell className="size-2.5" aria-hidden />}
                      target <Money cents={target} />
                    </span>
                  )}

                  {best && <ProvenanceBadge provenance={best.offer.provenance} />}
                  {best && <VerdictBadge verdict={best.deal.verdict} />}
                  <span className="w-20 text-right text-[13px] font-medium text-zinc-100 tnum">
                    {best ? <Money cents={best.offer.priceCents} /> : '—'}
                  </span>
                  <WatchToggle itemId={watch.itemId} watching />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
