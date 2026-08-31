import Link from 'next/link';
import { AddToBasketButton } from '@/components/BasketControls';
import { Money, Panel, PanelHeader, ProvenanceBadge } from '@/components/ui';
import { buildPriceBoard } from '@/server/view';

export const dynamic = 'force-dynamic';

export default function ItemsPage() {
  const { rows, categories } = buildPriceBoard();

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-zinc-100">All prices</h1>
        <p className="mt-1 text-[13px] text-zinc-500">
          Cheapest price for every catalog item across your selected stores. Spread is the gap between the cheapest and
          priciest store — a wide spread is where choosing the right store actually pays.
        </p>
      </div>

      {categories.map((category) => {
        const categoryRows = rows.filter((row) => row.item.category === category);
        return (
          <Panel key={category}>
            <PanelHeader title={category} hint={`${categoryRows.length} items`} />
            <div className="scroll-x">
              <table className="w-full min-w-[760px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line text-[11px] uppercase tracking-wide text-zinc-500">
                    <th className="px-5 py-2.5 font-semibold">Item</th>
                    <th className="px-3 py-2.5 font-semibold">Cheapest at</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Price</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Unit price</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Spread</th>
                    <th className="px-5 py-2.5 font-semibold">Basket</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/70">
                  {categoryRows.map((row) => (
                    <tr key={row.item.id} className="transition hover:bg-raised/40">
                      <td className="px-5 py-2.5">
                        <Link href={`/item/${row.item.id}`} className="font-medium text-zinc-100 hover:text-accent">
                          {row.item.name}
                        </Link>
                        <p className="text-[11px] text-zinc-600">{row.item.sizeLabel}</p>
                      </td>
                      <td className="px-3 py-2.5 text-zinc-300">
                        {row.bestStoreBanner ?? <span className="text-rose-300/80">not carried</span>}
                        {row.carriedCount > 0 && (
                          <p className="text-[11px] text-zinc-600">
                            {row.carriedCount} of your {row.carriedCount === 1 ? 'store' : 'stores'}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium text-zinc-100 tnum">
                        {row.bestPriceCents == null ? '—' : <Money cents={row.bestPriceCents} />}
                        {row.bestProvenance && (
                          <p className="mt-0.5">
                            <ProvenanceBadge provenance={row.bestProvenance} />
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-zinc-400 tnum">{row.unitPrice}</td>
                      <td className="px-3 py-2.5 text-right tnum">
                        {row.spreadCents === 0 ? (
                          <span className="text-zinc-600">—</span>
                        ) : (
                          <span className={row.spreadCents >= 200 ? 'font-medium text-amber-300/90' : 'text-zinc-500'}>
                            <Money cents={row.spreadCents} />
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-2.5">
                        <AddToBasketButton itemId={row.item.id} currentQuantity={row.quantityInBasket} label="Add" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
