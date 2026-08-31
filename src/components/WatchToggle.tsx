'use client';

import { useTransition } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { addWatchAction, removeWatchAction } from '@/app/actions';

/**
 * Watch an Item for price drops.
 *
 * The target is optional: with no target, "notify me when this hits a real low"
 * is judged against the Item's own 90-day distribution rather than a number the
 * user had to guess.
 */
export function WatchToggle({ itemId, watching }: { itemId: string; watching: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={watching}
      onClick={() =>
        startTransition(async () => {
          if (watching) await removeWatchAction(itemId);
          else await addWatchAction(itemId, null);
        })
      }
      className={
        watching
          ? 'inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent transition hover:bg-accent/15 disabled:opacity-50'
          : 'inline-flex items-center gap-1.5 rounded-lg border border-line bg-raised/60 px-2.5 py-1 text-[11px] font-medium text-zinc-400 transition hover:border-line-bright hover:text-zinc-200 disabled:opacity-50'
      }
    >
      {watching ? <Bell className="size-3" aria-hidden /> : <BellOff className="size-3" aria-hidden />}
      {watching ? 'Watching' : 'Watch price'}
    </button>
  );
}
