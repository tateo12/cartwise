import Link from 'next/link';
import { AddToBasketButton } from '@/components/BasketControls';
import { EmptyState, Panel, PanelHeader } from '@/components/ui';
import { suggestRestock } from '@/core/pantry';
import { allItems, basket, pantry } from '@/db/queries';

export const dynamic = 'force-dynamic';

export default function PantryPage() {
  const records = pantry();
  const items = new Map(allItems().map((i) => [i.id, i]));
  const quantities = new Map(basket().map((line) => [line.itemId, line.quantity]));
  const today = new Date().toISOString().slice(0, 10);

  const suggestions = suggestRestock(records, today);
  const staples = records.filter((r) => r.isStaple);

  if (records.length === 0) {
    return (
      <Panel>
        <EmptyState
          title="No purchase history yet"
          body="Log a shopping trip and Cartwise starts learning what you actually buy, then suggests next week's basket from your real habits."
          cta={{ href: '/receipts', label: 'Log a trip' }}
        />
      </Panel>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-zinc-100">Pantry</h1>
        <p className="mt-1 text-[13px] text-zinc-500">
          Built from the trips you&rsquo;ve logged. An item bought on three or more trips counts as a staple, and staples
          are assumed to run out on a roughly weekly cadence.
        </p>
      </div>

      <Panel>
        <PanelHeader
          title="Probably due for a restock"
          hint="Ranked by how overdue it is, weighted by how often you buy it"
        />
        {suggestions.length === 0 ? (
          <p className="px-5 py-6 text-xs text-zinc-500">
            Nothing looks overdue. Everything you buy regularly was purchased recently enough.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {suggestions.map((suggestion) => {
              const item = items.get(suggestion.itemId);
              if (!item) return null;
              return (
                <li key={suggestion.itemId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                  <span className="min-w-0 flex-1">
                    <Link href={`/item/${item.id}`} className="text-[13px] font-medium text-zinc-100 hover:text-accent">
                      {item.name}
                    </Link>
                    <p className="mt-0.5 text-[11px] text-zinc-500">{suggestion.reason}</p>
                  </span>
                  {/* The score is unitless, so it's shown as a bar rather than a
                      number that would invite over-interpretation. */}
                  <span className="hidden h-1 w-24 overflow-hidden rounded-full bg-line/70 sm:block" aria-hidden>
                    <span
                      className="block h-full rounded-full bg-amber-400/70"
                      style={{ width: `${Math.min(100, suggestion.score * 33).toFixed(0)}%` }}
                    />
                  </span>
                  <AddToBasketButton itemId={item.id} currentQuantity={quantities.get(item.id) ?? 0} label="Add" />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel>
        <PanelHeader title="Your staples" hint={`${staples.length} items bought on 3+ trips`} />
        <div className="scroll-x">
          <table className="w-full min-w-[560px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-zinc-500">
                <th className="px-5 py-2.5 font-semibold">Item</th>
                <th className="px-3 py-2.5 text-right font-semibold">Trips</th>
                <th className="px-3 py-2.5 text-right font-semibold">Last bought</th>
                <th className="px-5 py-2.5 font-semibold">Basket</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {records.map((record) => {
                const item = items.get(record.itemId);
                if (!item) return null;
                return (
                  <tr key={record.itemId} className="transition hover:bg-raised/40">
                    <td className="px-5 py-2.5">
                      <Link href={`/item/${item.id}`} className="text-zinc-100 hover:text-accent">
                        {item.name}
                      </Link>
                      {record.isStaple && (
                        <span className="ml-2 rounded bg-accent/10 px-1 py-0.5 text-[10px] font-semibold text-accent ring-1 ring-inset ring-accent/25">
                          staple
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-zinc-400 tnum">{record.purchaseCount}</td>
                    <td className="px-3 py-2.5 text-right text-zinc-500 tnum">{record.lastPurchasedAt ?? '—'}</td>
                    <td className="px-5 py-2.5">
                      <AddToBasketButton itemId={item.id} currentQuantity={quantities.get(item.id) ?? 0} label="Add" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
