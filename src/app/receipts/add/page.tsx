import Link from 'next/link';
import { ReceiptImporter } from '@/components/ReceiptImporter';
import { allItems, allStores } from '@/db/queries';

export const dynamic = 'force-dynamic';

/**
 * Import a receipt.
 *
 * The only route in the app to prices that are neither fetched nor invented,
 * and the only one that ever reaches WinCo or Trader Joe's, which publish no
 * prices online at any price.
 */
export default function AddReceiptPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-zinc-100">Add a receipt</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">
          Paste a till receipt and Cartwise reads the line items, matches them to your catalog, and saves what you
          actually paid. These become the only prices in the app that are real rather than seeded, and they are the
          only way to price WinCo or Trader Joe&rsquo;s at all.{' '}
          <Link href="/receipts" className="text-accent hover:text-emerald-300">
            See saved receipts
          </Link>
        </p>
      </div>

      <ReceiptImporter stores={allStores()} items={allItems()} />
    </div>
  );
}
