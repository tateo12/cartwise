import Link from 'next/link';
import { EmptyState, Money, Panel, PanelHeader } from '@/components/ui';
import { allItems, allStores, receiptLines, receipts } from '@/db/queries';

export const dynamic = 'force-dynamic';

export default function ReceiptsPage() {
  const rows = receipts();
  const stores = new Map(allStores().map((s) => [s.id, s]));
  const items = new Map(allItems().map((i) => [i.id, i]));

  if (rows.length === 0) {
    return (
      <Panel>
        <EmptyState
          title="No trips logged"
          body="Recorded trips are the only prices in Cartwise that are neither fetched nor seeded — they're what you actually paid, and they drive the pantry and staples list. Hit “I bought this” on the dashboard after a shop."
          cta={{ href: '/receipts/add', label: 'Add a receipt' }}
        />
      </Panel>
    );
  }

  const lifetimeCents = rows.reduce((sum, r) => sum + r.totalCents, 0);
  const seededCount = rows.filter((r) => r.seeded).length;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold tracking-tight text-zinc-100">Receipts</h1>
          <Link
            href="/receipts/add"
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-emerald-300"
          >
            Add a receipt
          </Link>
        </div>
        <p className="mt-1 text-[13px] text-zinc-500">
          {rows.length} logged {rows.length === 1 ? 'trip' : 'trips'} &middot;{' '}
          <span className="tnum"><Money cents={lifetimeCents} /></span> total.
          {seededCount > 0 && (
            <>
              {' '}
              <span className="text-amber-300/90">
                {seededCount} of these {seededCount === 1 ? 'is a sample trip' : 'are sample trips'}
              </span>{' '}
              created by the seeder so the pantry has something to work with — they are not prices you paid.
            </>
          )}{' '}
          Trips you log yourself are the only prices in Cartwise that are neither fetched nor seeded.
        </p>
      </div>

      {rows.map((receipt) => {
        const store = stores.get(receipt.storeId);
        const lines = receiptLines(receipt.id);
        return (
          <Panel key={receipt.id}>
            <PanelHeader
              title={store?.label ?? receipt.storeId}
              hint={`${receipt.purchasedAt} · ${receipt.lineCount} ${receipt.lineCount === 1 ? 'line' : 'lines'}`}
              action={
                <span className="flex items-center gap-2">
                  {receipt.seeded ? (
                    <span
                      title="Created by the seeder as sample data — not a price you paid"
                      className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300/90 ring-1 ring-inset ring-amber-500/25"
                    >
                      Sample
                    </span>
                  ) : (
                    <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-300 ring-1 ring-inset ring-sky-500/25">
                      You
                    </span>
                  )}
                  <span className="text-[15px] font-semibold text-zinc-100 tnum">
                    <Money cents={receipt.totalCents} />
                  </span>
                </span>
              }
            />
            <ul className="divide-y divide-line/70">
              {lines.map((line, position) => {
                const item = items.get(line.itemId);
                return (
                  <li
                    key={`${receipt.id}-${line.itemId}-${position}`}
                    className="flex items-center gap-4 px-5 py-2 text-[13px]"
                  >
                    <span className="min-w-0 flex-1">
                      {item ? (
                        <Link href={`/item/${item.id}`} className="text-zinc-200 hover:text-accent">
                          {item.name}
                        </Link>
                      ) : (
                        <span className="text-zinc-400">{line.itemId}</span>
                      )}
                      {line.quantity > 1 && <span className="ml-2 text-[11px] text-zinc-500">×{line.quantity}</span>}
                    </span>
                    <span className="text-zinc-400 tnum">
                      <Money cents={line.priceCents} />
                    </span>
                    <span className="w-20 text-right font-medium text-zinc-100 tnum">
                      <Money cents={line.priceCents * line.quantity} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panel>
        );
      })}
    </div>
  );
}
