'use client';

import { useState, useTransition } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { logCurrentPlanAction, type LogTripReport } from '@/app/actions';

/**
 * Records the recommended trip as actually purchased.
 *
 * Sends nothing — the server reads the current plan and its own prices. That
 * keeps receipts the one genuinely trustworthy price source in the app instead
 * of a channel for arbitrary client-supplied numbers.
 */
export function LogTripButton() {
  const [pending, startTransition] = useTransition();
  const [report, setReport] = useState<LogTripReport | null>(null);

  if (report) {
    if (report.receiptsCreated === 0 && report.alreadyLogged.length > 0) {
      return (
        <p className="text-[11px] text-zinc-500">Already logged today · {report.alreadyLogged.join(', ')}</p>
      );
    }
    return (
      <p className="text-[11px] text-accent tnum">
        Logged {report.receiptsCreated} {report.receiptsCreated === 1 ? 'receipt' : 'receipts'} ·{' '}
        {report.storeLabels.join(', ')}
        {report.alreadyLogged.length > 0 && (
          <span className="text-zinc-500"> · {report.alreadyLogged.join(', ')} already logged</span>
        )}
      </p>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(async () => setReport(await logCurrentPlanAction()))}
      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-ink/40 px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 transition hover:border-accent/40 hover:text-accent disabled:opacity-50"
    >
      <ClipboardCheck className="size-3" aria-hidden />
      {pending ? 'Logging…' : 'I bought this'}
    </button>
  );
}
