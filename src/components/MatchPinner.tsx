'use client';

import { useTransition } from 'react';
import { Check, Undo2 } from 'lucide-react';
import { pinMatchAction, unpinMatchAction } from '@/app/actions';

/**
 * Confirm or undo a Product-to-Item match.
 *
 * This is the correction mechanism ADR 0001 depends on: inferred matching is
 * only acceptable because the user can override it in one click, and a
 * confirmed match becomes permanent ground truth.
 */
export function MatchPinner({ productId, itemId, pinned }: { productId: string; itemId: string; pinned: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      title={pinned ? 'Remove your confirmation and let the matcher decide again' : 'Confirm this is the same item — overrides the matcher permanently'}
      onClick={() =>
        startTransition(async () => {
          if (pinned) await unpinMatchAction(productId);
          else await pinMatchAction(productId, itemId);
        })
      }
      className={
        pinned
          ? 'inline-flex items-center gap-1 rounded border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-300 transition hover:bg-violet-500/15 disabled:opacity-50'
          : 'inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 transition hover:border-accent/40 hover:text-accent disabled:opacity-50'
      }
    >
      {pinned ? <Undo2 className="size-2.5" aria-hidden /> : <Check className="size-2.5" aria-hidden />}
      {pinned ? 'Unpin' : 'Confirm'}
    </button>
  );
}
