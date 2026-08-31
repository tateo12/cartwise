import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AddToBasketButton } from '@/components/BasketControls';
import { MatchPinner } from '@/components/MatchPinner';
import { PriceCheckLinks } from '@/components/PriceCheckLinks';
import { PriceHistoryChart, type ChartSeries } from '@/components/PriceHistoryChart';
import { WatchToggle } from '@/components/WatchToggle';
import { seriesColor } from '@/components/palette';
import { ConfidenceBadge, Money, Panel, PanelHeader, ProductBrand, ProvenanceBadge, StatTile, StockNote, VerdictBadge, WasPrice } from '@/components/ui';
import { basket, buildOfferIndex, priceHistory, watches } from '@/db/queries';
import { quotesForItem } from '@/server/search';

export const dynamic = 'force-dynamic';

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const index = buildOfferIndex();
  const entry = quotesForItem(id, index);
  if (!entry) notFound();

  const quantities = new Map(basket().map((line) => [line.itemId, line.quantity]));
  const watching = watches().some((w) => w.itemId === id);

  // One history line per selected store, using that store's cheapest product.
  const series: ChartSeries[] = entry.quotes.map((quote, position) => ({
    storeId: quote.store.id,
    label: quote.store.banner,
    color: seriesColor(position),
    points: priceHistory(quote.product.id, quote.store.id).map((point) => ({
      date: point.date,
      priceCents: point.priceCents,
    })),
  }));

  const best = entry.best;
  const spread = entry.quotes.length > 1 ? entry.quotes[entry.quotes.length - 1].offer.priceCents - entry.quotes[0].offer.priceCents : 0;

  // The pack-price winner and the unit-price winner are often different stores,
  // and that gap IS the bulk-buying question. Saying only one of them would hide
  // the trade-off the user actually has to make.
  const comparable = entry.quotes.filter((q) => q.unitPriceCents != null);
  const bestByUnit = comparable.length
    ? comparable.reduce((a, b) => ((b.unitPriceCents as number) < (a.unitPriceCents as number) ? b : a))
    : null;
  const unitWinnerDiffers = bestByUnit != null && best != null && bestByUnit.store.id !== best.store.id;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">{entry.item.category}</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-zinc-100">{entry.item.name}</h1>
          <p className="mt-1 text-[13px] text-zinc-500">
            Standard pack {entry.item.sizeLabel}
            {entry.item.brandName && (
              <>
                {' '}&middot; name brand <span className="text-zinc-400">{entry.item.brandName}</span>
                {entry.item.upc && <span className="ml-1.5 font-mono text-[11px] text-zinc-600">UPC {entry.item.upc}</span>}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <WatchToggle itemId={id} watching={watching} />
          <AddToBasketButton itemId={id} currentQuantity={quantities.get(id) ?? 0} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Cheapest right now"
          value={best ? <Money cents={best.offer.priceCents} /> : '—'}
          detail={best ? `${best.store.banner} · ${best.unitPrice} · ${best.offer.provenance} price` : 'not carried by your stores'}
          tone={best ? 'good' : 'default'}
        />
        <StatTile
          label="Spread across stores"
          value={<Money cents={spread} />}
          detail={`between ${entry.quotes.length} selected stores`}
        />
        {/* A live price has no comparable history until live points accumulate,
            so quoting a seeded low next to it would be a category error. */}
        <StatTile
          label="90-day low"
          value={best && best.deal.verdict !== 'no-basis' ? <Money cents={best.deal.lowCents} /> : '—'}
          detail={
            best
              ? best.deal.verdict === 'no-basis'
                ? `no comparable history yet · ${best.deal.livePoints} live ${best.deal.livePoints === 1 ? 'point' : 'points'}`
                : `median $${(best.deal.medianCents / 100).toFixed(2)} at ${best.store.banner}`
              : undefined
          }
        />
      </div>

      {unitWinnerDiffers && bestByUnit && best && (
        <div className="rounded-xl border border-sky-500/25 bg-sky-500/[0.06] px-4 py-3">
          <p className="text-xs font-semibold text-sky-200">
            Cheapest pack and cheapest per unit are different stores
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-sky-100/70">
            <span className="font-medium">{best.store.banner}</span> has the cheapest pack at{' '}
            <span className="tnum"><Money cents={best.offer.priceCents} /></span> ({best.unitPrice}), but{' '}
            <span className="font-medium">{bestByUnit.store.banner}</span> is cheaper per unit at{' '}
            <span className="tnum">{bestByUnit.unitPrice}</span> — its {bestByUnit.product.sizeLabel} pack costs{' '}
            <span className="tnum"><Money cents={bestByUnit.offer.priceCents} /></span> up front. Worth it only if
            you&rsquo;ll use it all.{' '}
            <span className="inline-flex items-center gap-1 align-middle">
              <ProvenanceBadge provenance={best.offer.provenance} />
              <ProvenanceBadge provenance={bestByUnit.offer.provenance} />
            </span>
          </p>
        </div>
      )}

      <Panel>
        <PanelHeader
          title="Check the real price"
          hint="Opens the retailer's own page. This is the only way to see Walmart and Costco, which block automated reads entirely."
        />
        <div className="px-5 py-3.5">
          <PriceCheckLinks query={entry.item.name} emphasise={['walmart', 'costco']} />
          <p className="mt-2.5 text-[11px] leading-relaxed text-zinc-600">
            Stores marked <span className="text-zinc-500">$$</span> open an Instacart-powered storefront, where prices may
            include markup rather than the shelf price. Trader Joe&rsquo;s lists products but never prices.
          </p>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="90-day price history"
          hint="One line per selected store. The axis starts at the observed range, not zero, so real swings stay visible."
        />
        <PriceHistoryChart series={series} medianCents={best?.deal.medianCents} />
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line px-5 py-3">
          {series.map((line) => (
            <li key={line.storeId} className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              <span className="size-2 rounded-full" style={{ backgroundColor: line.color }} aria-hidden />
              {line.label}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel>
        <PanelHeader
          title="Matched products"
          hint="Confirm a match to make it permanent — your confirmation always beats the matcher"
        />
        <div className="scroll-x">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-zinc-500">
                <th className="px-5 py-2.5 font-semibold">Store</th>
                <th className="px-3 py-2.5 font-semibold">Product</th>
                <th className="px-3 py-2.5 font-semibold">Match</th>
                <th className="px-3 py-2.5 text-right font-semibold">Price</th>
                <th className="px-3 py-2.5 text-right font-semibold">Unit price</th>
                <th className="px-5 py-2.5 font-semibold">Signal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {entry.quotes.map((quote) => (
                <tr key={quote.store.id} className="transition hover:bg-raised/40">
                  <td className="px-5 py-3">
                    <span className="text-zinc-200">{quote.store.banner}</span>
                    <p className="mt-0.5 flex items-center gap-1.5">
                      <ProvenanceBadge provenance={quote.offer.provenance} />
                      <StockNote stock={quote.offer.stock} />
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    <ProductBrand brand={quote.product.brand} banner={quote.store.banner} />
                    <p className="text-[11px] text-zinc-500">{quote.product.sizeLabel}</p>
                  </td>
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-1.5">
                      <ConfidenceBadge confidence={quote.product.confidence} />
                      <MatchPinner
                        productId={quote.product.id}
                        itemId={entry.item.id}
                        pinned={quote.product.confidence === 'pinned'}
                      />
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right font-medium text-zinc-100 tnum">
                    <Money cents={quote.offer.priceCents} />
                    <WasPrice regularCents={quote.offer.regularPriceCents} currentCents={quote.offer.priceCents} />
                  </td>
                  <td className="px-3 py-3 text-right text-zinc-400 tnum">{quote.unitPrice}</td>
                  <td className="px-5 py-3">
                    <VerdictBadge verdict={quote.deal.verdict} />
                    <p className="mt-0.5 text-[10px] text-zinc-600 tnum">
                      {quote.deal.verdict === 'no-basis' ? (
                        'live price, seeded history'
                      ) : quote.deal.aboveLowCents === 0 ? (
                        'at its 90-day low'
                      ) : (
                        <>
                          <Money cents={quote.deal.aboveLowCents} /> above low
                        </>
                      )}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {entry.missingStores.length > 0 && (
          <p className="border-t border-line px-5 py-2.5 text-[11px] text-zinc-600">
            Not carried at {entry.missingStores.map((s) => s.banner).join(', ')}.{' '}
            <Link href="/stores" className="text-accent hover:text-emerald-300">
              Change your stores
            </Link>
          </p>
        )}
      </Panel>
    </div>
  );
}
