'use client';

import { useState, useTransition } from 'react';
import { RefreshCw } from 'lucide-react';
import { refreshLiveOffersAction } from '@/app/actions';
import type { RefreshReport } from '@/db/live';

/**
 * Pulls live Kroger prices over the seeded ones.
 *
 * Reports what was missed as well as what updated, because a partial refresh is
 * the normal case (Kroger's catalog will not match every seeded product) and
 * hiding that would recreate the "claims live, serves seeded" problem.
 */
export function RefreshLiveButton({ configured }: { configured: boolean }) {
  const [pending, startTransition] = useTransition();
  const [report, setReport] = useState<RefreshReport | null>(null);

  if (!configured) return null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setReport(await refreshLiveOffersAction());
          })
        }
        className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent transition hover:bg-accent/15 disabled:opacity-50"
      >
        <RefreshCw className={pending ? 'size-3 animate-spin' : 'size-3'} aria-hidden />
        {pending ? 'Fetching live prices…' : 'Refresh live prices'}
      </button>

      {report && (
        <p className="text-[11px] text-zinc-500 tnum">
          {report.updated} updated
          {report.missed > 0 && <span className="text-zinc-600"> · {report.missed} kept seeded</span>}
          {report.errors.length > 0 && <span className="text-rose-300/80"> · {report.errors[0]}</span>}
        </p>
      )}
    </div>
  );
}
