'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, Loader2, ScanLine } from 'lucide-react';
import { clsx } from 'clsx';
import { analyzeReceiptAction, saveReceiptImportAction } from '@/app/actions';
import type { ReceiptImport } from '@/server/receiptImport';
import type { Store } from '@/core/domain';
import type { ItemRecord } from '@/db/queries';
import { Money, Panel, PanelHeader } from '@/components/ui';

/**
 * Paste a receipt, confirm what it matched, save real prices.
 *
 * The confirmation step is not politeness. These become the app's only
 * `provenance: 'user'` prices, treated as ground truth, so a bad match here
 * would silently corrupt every comparison afterwards. Anything the matcher is
 * unsure about is shown as unsure and defaults to being skipped.
 */
export function ReceiptImporter({ stores, items }: { stores: Store[]; items: ItemRecord[] }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [result, setResult] = useState<ReceiptImport | null>(null);
  const [storeId, setStoreId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const [skipped, setSkipped] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ lineCount: number } | null>(null);
  const [pending, startTransition] = useTransition();

  const analyze = () => {
    setError(null);
    startTransition(async () => {
      try {
        const parsed = await analyzeReceiptAction(text);
        setResult(parsed);
        setStoreId(parsed.storeId ?? stores[0]?.id ?? '');
        // Pre-select the matcher's pick; lines it could not match start skipped.
        const picks: Record<number, string> = {};
        const skips: Record<number, boolean> = {};
        parsed.matched.forEach((entry, index) => {
          if (entry.item) picks[index] = entry.item.id;
          else skips[index] = true;
        });
        setChosen(picks);
        setSkipped(skips);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not read that.');
      }
    });
  };

  const save = () => {
    if (!result) return;
    setError(null);
    startTransition(async () => {
      try {
        const lines = result.matched
          .map((entry, index) => ({ entry, index }))
          .filter(({ index }) => !skipped[index] && chosen[index])
          .map(({ entry, index }) => ({
            itemId: chosen[index],
            priceCents: entry.unitPriceCents,
            quantity: entry.line.quantity,
          }));
        if (lines.length === 0) {
          setError('Nothing selected to save.');
          return;
        }
        const outcome = await saveReceiptImportAction(storeId, date, lines);
        setSaved({ lineCount: outcome.lineCount });
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not save.');
      }
    });
  };

  if (saved) {
    return (
      <Panel className="px-5 py-8 text-center">
        <p className="text-sm font-semibold text-accent">
          Saved {saved.lineCount} real {saved.lineCount === 1 ? 'price' : 'prices'}
        </p>
        <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-zinc-500">
          These are badged <span className="font-medium text-sky-300">You</span> everywhere they appear, because they are
          the only prices in Cartwise that are neither fetched nor invented. They also feed your pantry and staples.
        </p>
        <button
          type="button"
          onClick={() => {
            setSaved(null);
            setResult(null);
            setText('');
          }}
          className="mt-4 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-emerald-300"
        >
          Add another receipt
        </button>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title="Paste your receipt"
          hint="On iPhone: photograph the receipt, long-press the image, Live Text will let you copy it"
        />
        <div className="px-5 py-4">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={10}
            spellCheck={false}
            placeholder={"SMITH'S FOOD & DRUG\n\nKRO WHOLE MILK GAL      3.29 F\nBANANAS 2.13 lb @ $0.58/lb   1.24 F\n2 @ 1.99  KRO LG EGGS 18CT   3.98 F\n            TOTAL           25.55"}
            className="w-full rounded-xl border border-line bg-ink/50 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-zinc-200 placeholder:text-zinc-700 focus:border-line-bright focus:outline-none"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={pending || text.trim().length === 0}
              onClick={analyze}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-3.5 py-2 text-[13px] font-semibold text-ink transition hover:bg-emerald-300 disabled:opacity-50"
            >
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ScanLine className="size-4" aria-hidden />}
              {pending ? 'Reading…' : 'Read receipt'}
            </button>
            {error && <span className="text-[11px] text-rose-300">{error}</span>}
          </div>
        </div>
      </Panel>

      {result && (
        <Panel>
          <PanelHeader
            title="Check what it read"
            hint="Confirm each line before saving. Anything it was unsure about starts unchecked."
            action={
              <span className="text-[15px] font-semibold text-zinc-100 tnum">
                <Money cents={result.parsedTotalCents} />
              </span>
            }
          />

          {/* A parse that does not add up means lines were missed. Say so before
              the user commits it as ground truth. */}
          {!result.looksComplete && (
            <p className="flex items-start gap-2 border-b border-amber-500/25 bg-amber-500/[0.07] px-5 py-3 text-[11px] leading-relaxed text-amber-100/80">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                The lines read add up to <Money cents={result.parsedTotalCents} />
                {result.statedTotalCents != null && (
                  <> but the receipt says <Money cents={result.statedTotalCents} /></>
                )}
                . Some lines were probably missed, so check before saving.
              </span>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
            <label className="text-[11px] text-zinc-500">
              Store
              <select
                value={storeId}
                onChange={(event) => setStoreId(event.target.value)}
                className="ml-2 rounded-lg border border-line bg-raised px-2 py-1 text-[12px] text-zinc-200"
              >
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] text-zinc-500">
              Date
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="ml-2 rounded-lg border border-line bg-raised px-2 py-1 text-[12px] text-zinc-200"
              />
            </label>
          </div>

          <ul className="divide-y divide-line/70">
            {result.matched.map((entry, index) => {
              const isSkipped = skipped[index] === true;
              return (
                <li key={`${entry.line.raw}-${index}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-2.5">
                  <button
                    type="button"
                    aria-label={isSkipped ? 'Include this line' : 'Skip this line'}
                    onClick={() => setSkipped((prev) => ({ ...prev, [index]: !isSkipped }))}
                    className={clsx(
                      'grid size-4.5 shrink-0 place-items-center rounded border transition',
                      isSkipped ? 'border-line-bright' : 'border-accent bg-accent text-ink',
                    )}
                  >
                    {!isSkipped && <Check className="size-3" strokeWidth={3} aria-hidden />}
                  </button>

                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[11px] text-zinc-500">{entry.line.raw}</span>
                    <select
                      value={chosen[index] ?? ''}
                      onChange={(event) => {
                        setChosen((prev) => ({ ...prev, [index]: event.target.value }));
                        if (event.target.value) setSkipped((prev) => ({ ...prev, [index]: false }));
                      }}
                      className="mt-1 max-w-full rounded-lg border border-line bg-raised px-2 py-1 text-[12px] text-zinc-200"
                    >
                      <option value="">— not in catalog, skip —</option>
                      {/* Suggestions first, then everything, so a wrong guess is
                          one click to fix rather than a hunt. */}
                      {entry.alternatives.map((item) => (
                        <option key={`alt-${item.id}`} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                      {items
                        .filter((item) => !entry.alternatives.some((alt) => alt.id === item.id))
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                    </select>
                  </span>

                  {entry.item && entry.confidence < 0.75 && (
                    <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 ring-1 ring-inset ring-amber-500/25">
                      unsure
                    </span>
                  )}
                  {entry.line.quantity > 1 && (
                    <span className="text-[11px] text-zinc-500 tnum">×{entry.line.quantity}</span>
                  )}
                  <span className="w-16 text-right text-[13px] font-medium text-zinc-100 tnum">
                    <Money cents={entry.unitPriceCents} />
                  </span>
                </li>
              );
            })}
          </ul>

          {result.unparsed.length > 0 && (
            <p className="border-t border-line px-5 py-2.5 text-[11px] text-zinc-600">
              {result.unparsed.length} {result.unparsed.length === 1 ? 'line' : 'lines'} could not be read:{' '}
              <span className="font-mono">{result.unparsed.slice(0, 3).join(' · ')}</span>
            </p>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3.5">
            <span className="text-[11px] text-zinc-500">
              {result.matched.filter((_, index) => !skipped[index] && chosen[index]).length} of {result.matched.length}{' '}
              lines will be saved
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={save}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-3.5 py-2 text-[13px] font-semibold text-ink transition hover:bg-emerald-300 disabled:opacity-50"
            >
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Save real prices
            </button>
          </div>
        </Panel>
      )}
    </div>
  );
}
