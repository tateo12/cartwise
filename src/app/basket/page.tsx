import Link from 'next/link';
import { QuantityStepper } from '@/components/BasketControls';
import { ClearBasketButton } from '@/components/ClearBasketButton';
import { ConfidenceBadge, EmptyState, Money, Panel, PanelHeader, ProvenanceBadge, VerdictBadge } from '@/components/ui';
import { buildBasketView } from '@/server/view';

export const dynamic = 'force-dynamic';

export default function BasketPage() {
  const view = buildBasketView();

  if (view.rows.length === 0) {
    return (
      <Panel>
        <EmptyState
          title="Your basket is empty"
          body="Add items and Cartwise works out where the whole basket costs least."
          cta={{ href: '/items', label: 'Browse prices' }}
        />
      </Panel>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-100">Basket</h1>
          <p className="mt-1 text-[13px] text-zinc-500">
            {view.rows.length} {view.rows.length === 1 ? 'line' : 'lines'} &middot; {view.itemCount} items &middot; cheapest
            complete total <span className="font-medium text-accent tnum"><Money cents={view.result.winner.totalCents} /></span>
          </p>
        </div>
        <ClearBasketButton />
      </div>

      <Panel>
        <PanelHeader title="Lines" hint="Quantity is in packs — the unit price column already accounts for pack size" />
        <ul className="divide-y divide-line">
          {view.rows.map((row) => (
            <li key={row.item.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
              <span className="min-w-0 flex-1">
                <Link href={`/item/${row.item.id}`} className="text-[13px] font-medium text-zinc-100 hover:text-accent">
                  {row.item.name}
                </Link>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                  {row.store.banner} &middot; {row.assignment.product.sizeLabel}
                  <ConfidenceBadge confidence={row.assignment.product.confidence} />
                  <ProvenanceBadge provenance={row.assignment.offer.provenance} />
                  <VerdictBadge verdict={row.deal.verdict} />
                </span>
              </span>
              <QuantityStepper itemId={row.item.id} quantity={row.assignment.quantity} />
              <span className="w-20 text-right text-[11px] text-zinc-500 tnum">{row.unitPrice}</span>
              <span className="w-20 text-right text-[13px] font-medium text-zinc-100 tnum">
                <Money cents={row.assignment.lineTotalCents} />
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
