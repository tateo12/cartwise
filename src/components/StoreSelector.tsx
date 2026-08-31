'use client';

import { useState, useTransition } from 'react';
import { clsx } from 'clsx';
import { Check, Loader2 } from 'lucide-react';
import type { Store } from '@/core/domain';
import { setSelectedStoresAction } from '@/app/actions';

/**
 * Store selection. This IS the comparison universe — an unselected store's
 * prices never enter any total, anywhere in the app.
 *
 * Selection is applied optimistically so toggling feels instant, but the server
 * remains the source of truth: a failed action reverts the local state rather
 * than leaving the UI claiming a selection the database doesn't have.
 */
export function StoreSelector({
  stores,
  selected,
  providerByChain,
}: {
  stores: Store[];
  selected: string[];
  providerByChain: Record<string, 'kroger' | 'seed'>;
}) {
  const [local, setLocal] = useState<string[]>(selected);
  const [pending, startTransition] = useTransition();

  const toggle = (storeId: string) => {
    const next = local.includes(storeId) ? local.filter((id) => id !== storeId) : [...local, storeId];
    const previous = local;
    setLocal(next);
    startTransition(async () => {
      try {
        await setSelectedStoresAction(next);
      } catch {
        setLocal(previous);
      }
    });
  };

  return (
    <div>
      <ul className="divide-y divide-line">
        {stores.map((store) => {
          const active = local.includes(store.id);
          const live = providerByChain[store.chainId] === 'kroger';
          return (
            <li key={store.id}>
              <button
                type="button"
                onClick={() => toggle(store.id)}
                aria-pressed={active}
                className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-raised/40"
              >
                <span
                  aria-hidden
                  className={clsx(
                    'flex size-4.5 shrink-0 items-center justify-center rounded border transition',
                    active ? 'border-accent bg-accent text-ink' : 'border-line-bright bg-transparent',
                  )}
                >
                  {active && <Check className="size-3" strokeWidth={3} />}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[13px] font-medium text-zinc-100">
                    {store.label}
                    {live ? (
                      <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
                        Live API
                      </span>
                    ) : (
                      <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300/90 ring-1 ring-inset ring-amber-500/25">
                        Seeded
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-zinc-500">{store.address}</span>
                </span>

                <span className="shrink-0 text-[11px] text-zinc-500 tnum">{store.driveMinutes} min</span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center gap-2 border-t border-line px-5 py-3 text-[11px] text-zinc-500">
        {pending && <Loader2 className="size-3 animate-spin text-accent" aria-hidden />}
        <span>
          {local.length === 0
            ? 'No stores selected — nothing can be compared until you pick at least one.'
            : `Comparing ${local.length} ${local.length === 1 ? 'store' : 'stores'}.`}
        </span>
      </div>
    </div>
  );
}
