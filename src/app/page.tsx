import Link from 'next/link';
import { AlertTriangle, ArrowRight, Car, MapPin, TriangleAlert } from 'lucide-react';
import { LogTripButton } from '@/components/LogTripButton';
import { PriceCheckLinks } from '@/components/PriceCheckLinks';
import { buildBasketView } from '@/server/view';
import { Money, Panel, PanelHeader, ProductBrand, ProvenanceBadge, ConfidenceBadge, StatTile, VerdictBadge, StockNote, EmptyState, WasPrice } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default function DashboardPage() {
  const view = buildBasketView();
  const { result, rows } = view;
  // The Plan now carries its own anchor, so the UI never has to infer which
  // store the headline is about — inferring it used to fall through to a forced
  // store and render "WinCo doesn't carry X — picked up at WinCo".
  const headlineStore = view.selectedStores.find((s) => s.id === result.winner.anchorId);
  const savingsVsNextBest = Math.max(0, view.nextBestTotalCents - result.winner.totalCents);
  const runnerUp = view.selectedStores.find((s) => s.id === view.runnerUpStoreId);

  if (view.empty) {
    return (
      <Panel>
        <EmptyState
          title="No stores selected"
          body="Cartwise only compares the stores you pick — nothing is compared until you choose at least one."
          cta={{ href: '/stores', label: 'Choose your stores' }}
        />
      </Panel>
    );
  }

  if (rows.length === 0 && view.unavailable.length > 0) {
    return (
      <Panel>
        <EmptyState
          title="None of your stores carry these items"
          body={`${view.unavailable.map((i) => i.name).join(', ')} — nothing in your basket is available at the stores you selected, so there is no trip to price. Add a store, or swap the items.`}
          cta={{ href: '/stores', label: 'Add a store' }}
        />
      </Panel>
    );
  }

  if (rows.length === 0) {
    return (
      <Panel>
        <EmptyState
          title="Your basket is empty"
          body="Add the things you actually buy and Cartwise will tell you where the whole basket is cheapest."
          cta={{ href: '/items', label: 'Browse prices' }}
        />
      </Panel>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* ── Headline: the one answer. Deliberately NOT the lowest possible
             number — see ADR 0002. ─────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        <div className="hero px-6 py-6">
          <p className="eyebrow">This week&rsquo;s basket &middot; {view.itemCount} items</p>

          <div className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-2">
            <div>
              <p className="text-[13px] font-medium text-zinc-400">Shop at</p>
              <p className="text-3xl font-semibold tracking-tight text-zinc-50">{headlineStore?.banner ?? '—'}</p>
            </div>
            <ArrowRight className="mb-1.5 size-5 text-zinc-600" aria-hidden />
            <p className="mb-0.5 text-4xl font-semibold tracking-tight text-accent tnum">
              <Money cents={result.winner.totalCents} />
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-zinc-400">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-3.5 text-zinc-500" aria-hidden />
              {result.winner.storeIds.length} {result.winner.storeIds.length === 1 ? 'stop' : 'stops'}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Car className="size-3.5 text-zinc-500" aria-hidden />
              {result.winner.driveMinutes} min of driving
            </span>
            {headlineStore && <span className="text-zinc-600">{headlineStore.address}</span>}
          </div>

          {/* Where the money actually goes, per stop. Also fills what would
              otherwise be dead space beside the three stat tiles. */}
          <ul className="mt-5 flex flex-wrap gap-2">
            {result.winner.storeIds.map((storeId) => {
              const store = view.selectedStores.find((s) => s.id === storeId);
              const spend = result.winner.assignments
                .filter((a) => a.storeId === storeId)
                .reduce((sum, a) => sum + a.lineTotalCents, 0);
              const lines = result.winner.assignments.filter((a) => a.storeId === storeId).length;
              return (
                <li
                  key={storeId}
                  className="rounded-lg border border-line bg-ink/40 px-2.5 py-1.5 text-[11px] text-zinc-400"
                >
                  <span className="font-medium text-zinc-200">{store?.banner ?? storeId}</span>
                  <span className="mx-1.5 text-zinc-600">&middot;</span>
                  <span className="tnum">{lines} {lines === 1 ? 'line' : 'lines'}</span>
                  <span className="mx-1.5 text-zinc-600">&middot;</span>
                  <span className="font-medium text-zinc-200 tnum">
                    <Money cents={spend} />
                  </span>
                </li>
              );
            })}
            <li className="ml-auto self-center">
              <LogTripButton />
            </li>
          </ul>

          {/* Where the money concentrates. Four lines routinely account for
              half a grocery bill, and they're the ones worth checking a second
              store for — so they earn the space a one-stop trip leaves free. */}
          <div className="mt-5">
            <p className="eyebrow">Biggest lines</p>
            <ul className="mt-2 space-y-1.5">
              {[...rows]
                .sort((a, b) => b.assignment.lineTotalCents - a.assignment.lineTotalCents)
                .slice(0, 4)
                .map((row) => {
                  const share = result.winner.totalCents > 0 ? row.assignment.lineTotalCents / result.winner.totalCents : 0;
                  return (
                    <li key={row.item.id} className="flex items-center gap-3 text-[11px]">
                      <span className="w-40 shrink-0 truncate text-zinc-300">{row.item.name}</span>
                      <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-line/60" aria-hidden>
                        <span
                          className="block h-full rounded-full bg-accent/60"
                          style={{ width: `${Math.max(3, share * 100 * 2.6).toFixed(1)}%` }}
                        />
                      </span>
                      <span className="w-12 shrink-0 text-right text-zinc-400 tnum">
                        <Money cents={row.assignment.lineTotalCents} />
                      </span>
                      <span className="w-9 shrink-0 text-right text-zinc-600 tnum">
                        {(share * 100).toFixed(0)}%
                      </span>
                    </li>
                  );
                })}
            </ul>
          </div>

          {/* A forced stop is the honest consequence of a store not carrying
              something. Never hidden, because it changes the trip. */}
          {result.winner.forcedStopIds.length > 0 && (
            <div className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-3.5 py-2.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-200">
                <TriangleAlert className="size-3.5" aria-hidden />
                {result.winner.forcedStopIds.length} forced extra{' '}
                {result.winner.forcedStopIds.length === 1 ? 'stop' : 'stops'}
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {rows
                  .filter((row) => row.assignment.forced)
                  .map((row) => (
                    <li key={row.item.id} className="text-[11px] text-amber-100/70">
                      {headlineStore?.banner} doesn&rsquo;t carry <span className="font-medium">{row.item.name}</span> — picked
                      up at {row.store.banner} for <Money cents={row.assignment.offer.priceCents} />{' '}
                      <ProvenanceBadge provenance={row.assignment.offer.provenance} />
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1 lg:grid-rows-3">
          {/* Compared against the RUNNER-UP, not the priciest store: a
              warehouse club's higher total reflects bigger packs, not worse
              prices, so "vs. worst" would overstate the saving. */}
          {/* Explicitly "next single store", not "next cheapest trip" — a
              multi-stop plan can beat the headline, and the ladder below is
              where that comparison belongs. */}
          <StatTile
            label="vs. next single store"
            value={<Money cents={savingsVsNextBest} />}
            detail={
              runnerUp
                ? `cheaper than ${runnerUp.banner} · see ladder for multi-stop`
                : 'no alternative selected'
            }
            tone={savingsVsNextBest > 0 ? 'good' : 'default'}
          />
          <StatTile
            label="Real lows in basket"
            value={view.realLowCount}
            detail="at or near a 90-day low"
            tone={view.realLowCount > 0 ? 'good' : 'default'}
          />
          <StatTile
            label="Fake sales caught"
            value={view.fakeSaleCount}
            detail="sale tag, but not actually cheap"
            tone={view.fakeSaleCount > 0 ? 'warn' : 'default'}
          />
        </div>
      </div>

      {/* ── Items no selected store carries at all ───────────────────────── */}
      {view.unavailable.length > 0 && (
        <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.06] px-4 py-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-200">
            <AlertTriangle className="size-3.5" aria-hidden />
            {view.unavailable.length} {view.unavailable.length === 1 ? 'item' : 'items'} not carried by any store you selected
          </p>
          <p className="mt-1 text-[11px] text-rose-100/70">
            {view.unavailable.map((i) => i.name).join(', ')} — this basket cannot be completed as selected.{' '}
            <Link href="/stores" className="underline decoration-rose-400/40 hover:decoration-rose-300">
              Add a store
            </Link>
          </p>
        </div>
      )}

      {/* ── The savings ladder: the upsell, never the headline ───────────── */}
      <Panel>
        <PanelHeader
          title="Could you do better?"
          hint="Multi-stop plans, ranked by what they actually save you"
        />
        {result.ladder.length === 0 ? (
          <p className="px-5 py-6 text-xs text-zinc-500">
            No multi-stop plan beats one stop at {headlineStore?.banner} this week. Enjoy the short trip.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {result.ladder.map((row) => (
              <li key={row.plan.storeIds.join('+')} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                <span className="min-w-0 flex-1 text-[13px] text-zinc-300">
                  {row.plan.storeIds
                    .map((id) => view.selectedStores.find((s) => s.id === id)?.banner ?? id)
                    .join('  +  ')}
                </span>
                <span className="text-[13px] text-zinc-400 tnum">
                  <Money cents={row.plan.totalCents} />
                </span>
                <span className="w-24 text-right text-[13px] font-semibold text-accent tnum">
                  save <Money cents={row.savingsCents} />
                </span>
                <span className="w-16 text-right text-[11px] text-zinc-500">
                  {row.stops} stops
                </span>
                <span className="w-20 text-right text-[11px] text-zinc-500 tnum">
                  {row.plan.driveMinutes} min
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* ── Line-by-line: where each item comes from and whether it's a deal ─ */}
      <Panel>
        <PanelHeader
          title="Your basket, line by line"
          hint="Unit price is the honest comparison — pack size and multi-packs are already applied"
          action={
            <Link href="/basket" className="text-xs font-medium text-accent hover:text-emerald-300">
              Edit basket
            </Link>
          }
        />
        <div className="scroll-x">
          <table className="w-full min-w-[820px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-zinc-500">
                <th className="px-5 py-2.5 font-semibold">Item</th>
                <th className="px-3 py-2.5 font-semibold">Cheapest at</th>
                <th className="px-3 py-2.5 font-semibold">Product</th>
                <th className="px-3 py-2.5 text-right font-semibold">Price</th>
                <th className="px-3 py-2.5 text-right font-semibold">Unit price</th>
                <th className="px-5 py-2.5 font-semibold">Signal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {rows.map((row) => (
                <tr key={row.item.id} className="transition hover:bg-raised/40">
                  <td className="px-5 py-3">
                    <Link href={`/item/${row.item.id}`} className="font-medium text-zinc-100 hover:text-accent">
                      {row.item.name}
                    </Link>
                    <p className="text-[11px] text-zinc-500">
                      {row.item.category}
                      {row.assignment.quantity > 1 && <span className="text-zinc-400"> &middot; ×{row.assignment.quantity}</span>}
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-zinc-200">{row.store.banner}</span>
                    {row.assignment.forced && (
                      <span className="ml-1.5 rounded bg-amber-500/10 px-1 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-inset ring-amber-500/25">
                        detour
                      </span>
                    )}
                    <p className="mt-0.5 flex items-center gap-1.5">
                      <ProvenanceBadge provenance={row.assignment.offer.provenance} />
                      <StockNote stock={row.assignment.offer.stock} />
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    <ProductBrand brand={row.assignment.product.brand} banner={row.store.banner} />
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-500">
                      {row.assignment.product.sizeLabel}
                      <ConfidenceBadge confidence={row.assignment.product.confidence} />
                    </p>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <span className="font-medium text-zinc-100 tnum">
                      <Money cents={row.assignment.lineTotalCents} />
                    </span>
                    <WasPrice
                      regularCents={row.assignment.offer.regularPriceCents}
                      currentCents={row.assignment.offer.priceCents}
                      quantity={row.assignment.quantity}
                    />
                  </td>
                  <td className="px-3 py-3 text-right text-zinc-400 tnum">{row.unitPrice}</td>
                  <td className="px-5 py-3">
                    <VerdictBadge verdict={row.deal.verdict} />
                    {row.deal.verdict === 'no-basis' ? (
                      <p className="mt-0.5 text-[10px] text-zinc-600">
                        live price, seeded history
                      </p>
                    ) : (
                      row.deal.verdict !== 'real-low' &&
                      row.deal.aboveLowCents > 0 && (
                        <p className="mt-0.5 text-[10px] text-zinc-600 tnum">
                          <Money cents={row.deal.aboveLowCents} /> above its 90-day low
                        </p>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line-bright">
                <td colSpan={3} className="px-5 py-3 text-[11px] uppercase tracking-wide text-zinc-500">
                  Complete basket
                </td>
                <td className="px-3 py-3 text-right text-base font-semibold text-accent tnum">
                  <Money cents={result.winner.totalCents} />
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </Panel>

      {/* ── Stores no automated route can price ─────────────────────────── */}
      <Panel>
        <PanelHeader
          title="Stores Cartwise can't price"
          hint="Walmart and Costco block automated reads; Trader Joe's publishes no prices at all. Tap through to check the biggest lines yourself."
        />
        <ul className="divide-y divide-line">
          {[...rows]
            .sort((a, b) => b.assignment.lineTotalCents - a.assignment.lineTotalCents)
            .slice(0, 5)
            .map((row) => (
              <li key={row.item.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5">
                <span className="min-w-0 flex-1 text-[13px] text-zinc-300">{row.item.name}</span>
                <span className="text-[11px] text-zinc-600 tnum">
                  yours: <Money cents={row.assignment.offer.priceCents} /> at {row.store.banner}
                </span>
                <PriceCheckLinks
                  query={row.item.name}
                  chainIds={['walmart', 'costco', 'traderjoes']}
                  emphasise={['walmart']}
                />
              </li>
            ))}
        </ul>
      </Panel>

      {/* ── Full store-by-store comparison ──────────────────────────────── */}
      <Panel>
        <PanelHeader
          title="Every selected store, complete basket"
          hint="Ordered by cost. Each total buys ALL your items — a store that doesn't carry something is charged for sourcing it elsewhere, not let off the hook. A row cheaper than the headline needs more stops to get there."
          action={
            <Link href="/stores" className="text-xs font-medium text-accent hover:text-emerald-300">
              Manage stores
            </Link>
          }
        />
        <ul className="divide-y divide-line">
          {view.comparisons.map((entry, position) => {
            const store = view.selectedStores.find((s) => s.id === entry.storeId);
            const delta = entry.totalCents - result.winner.totalCents;
            const share = view.worstTotalCents > 0 ? entry.totalCents / view.worstTotalCents : 0;
            return (
              <li key={entry.storeId} className="px-5 py-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="w-5 text-[11px] text-zinc-600 tnum">{position + 1}</span>
                  <span className="min-w-0 flex-1 text-[13px] font-medium text-zinc-200">
                    {store?.banner ?? entry.storeId}
                    {entry.forcedStopCount > 0 && (
                      <span className="ml-2 text-[11px] font-normal text-amber-300/80">
                        +{entry.forcedStopCount} forced stop{entry.forcedStopCount === 1 ? '' : 's'}
                      </span>
                    )}
                    {entry.unavailableCount > 0 && (
                      <span className="ml-2 text-[11px] font-normal text-rose-300/80">
                        can&rsquo;t complete basket
                      </span>
                    )}
                    {entry.largerPacks && (
                      <span
                        title="This store sells bigger packs, so a higher total buys more product. Compare the unit price column instead."
                        className="ml-2 rounded bg-sky-500/10 px-1 py-0.5 text-[10px] font-medium text-sky-300 ring-1 ring-inset ring-sky-500/25"
                      >
                        bigger packs
                      </span>
                    )}
                  </span>
                  <span className="w-14 text-right text-[11px] text-zinc-500 tnum">
                    {entry.stops} {entry.stops === 1 ? 'stop' : 'stops'}
                  </span>
                  <span className="text-[13px] font-medium text-zinc-100 tnum">
                    <Money cents={entry.totalCents} />
                  </span>
                  {/* Signed honestly. A cheaper-but-multi-stop plan really is
                      BELOW the headline on price, and hardcoding "+" here
                      rendered it as "+−$12.40". */}
                  <span className="w-24 text-right text-[12px] tnum">
                    {entry.isWinner ? (
                      <span className="font-semibold text-accent">headline</span>
                    ) : delta < 0 ? (
                      <span className="text-accent/80" title="Cheaper than the headline, but needs more stops">
                        −<Money cents={Math.abs(delta)} />
                      </span>
                    ) : (
                      <span className="text-zinc-500">
                        +<Money cents={delta} />
                      </span>
                    )}
                  </span>
                </div>
                {/* Bar is scaled against the priciest store, so the spread is
                    visible at a glance rather than requiring arithmetic. */}
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-line/70">
                  <div
                    className={entry.isWinner ? 'h-full rounded-full bg-accent' : 'h-full rounded-full bg-zinc-600'}
                    style={{ width: `${Math.max(4, share * 100).toFixed(1)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
