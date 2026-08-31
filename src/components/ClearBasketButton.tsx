'use client';

import { useState, useTransition } from 'react';
import { clearBasketAction } from '@/app/actions';

/**
 * Clearing the basket is destructive and easy to hit by accident, so it takes a
 * deliberate second click rather than firing on the first.
 */
export function ClearBasketButton() {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-zinc-400 transition hover:border-line-bright hover:text-zinc-200"
      >
        Clear basket
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await clearBasketAction();
            setConfirming(false);
          })
        }
        className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-200 transition hover:bg-rose-500/15 disabled:opacity-50"
      >
        {pending ? 'Clearing…' : 'Really clear'}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-[11px] font-medium text-zinc-500 hover:text-zinc-300"
      >
        Cancel
      </button>
    </span>
  );
}
