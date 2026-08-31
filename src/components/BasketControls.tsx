'use client';

import { useTransition } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { updateBasketQuantityAction } from '@/app/actions';

/** Stepper for one basket line. Quantity is in PACKS, not base units. */
export function QuantityStepper({ itemId, quantity }: { itemId: string; quantity: number }) {
  const [pending, startTransition] = useTransition();

  const set = (next: number) => {
    startTransition(async () => {
      await updateBasketQuantityAction(itemId, next);
    });
  };

  return (
    <div className="inline-flex items-center gap-1" data-pending={pending || undefined}>
      <button
        type="button"
        onClick={() => set(quantity - 1)}
        aria-label={quantity <= 1 ? 'Remove from basket' : 'Decrease quantity'}
        className="grid size-6 place-items-center rounded border border-line text-zinc-400 transition hover:border-line-bright hover:text-zinc-200"
      >
        {quantity <= 1 ? <Trash2 className="size-3" aria-hidden /> : <Minus className="size-3" aria-hidden />}
      </button>
      <span className="w-7 text-center text-[13px] font-medium text-zinc-200 tnum">{quantity}</span>
      <button
        type="button"
        onClick={() => set(quantity + 1)}
        aria-label="Increase quantity"
        className="grid size-6 place-items-center rounded border border-line text-zinc-400 transition hover:border-line-bright hover:text-zinc-200"
      >
        <Plus className="size-3" aria-hidden />
      </button>
    </div>
  );
}

/** Adds an Item to the basket, or bumps it if already present. */
export function AddToBasketButton({
  itemId,
  currentQuantity,
  label = 'Add to basket',
}: {
  itemId: string;
  currentQuantity: number;
  label?: string;
}) {
  const [pending, startTransition] = useTransition();

  if (currentQuantity > 0) return <QuantityStepper itemId={itemId} quantity={currentQuantity} />;

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await updateBasketQuantityAction(itemId, 1);
        })
      }
      className="rounded-lg border border-line bg-raised/60 px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition hover:border-accent/40 hover:text-accent disabled:opacity-50"
    >
      {pending ? 'Adding…' : label}
    </button>
  );
}
