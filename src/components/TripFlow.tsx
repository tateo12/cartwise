'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Car, Check, ClipboardCopy, ExternalLink, Loader2, MapPin, ShoppingCart, TriangleAlert } from 'lucide-react';
import { clsx } from 'clsx';
import { pushKrogerCartAction, refreshLiveOffersAction } from '@/app/actions';
import type { TripStoreGroup, TripView } from '@/server/trip';
import { Money, Panel, PanelHeader } from '@/components/ui';

/**
 * The shopping-trip flow: review, choose a plan, then order.
 *
 * Three steps because they are three different decisions. "What am I buying"
 * and "where am I going" and "how do I actually order it" get conflated on most
 * shopping apps, and the middle one is the whole point of this app.
 */
type Step = 'review' | 'choose' | 'order';

export function TripFlow({ view }: { view: TripView }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('review');
  const [chosenId, setChosenId] = useState<string>(view.options[0]?.id ?? '');
  const [pending, startTransition] = useTransition();
  const [refreshNote, setRefreshNote] = useState<string | null>(null);

  const chosen = view.options.find((option) => option.id === chosenId) ?? view.options[0];

  /**
   * "Ready" pulls fresh prices where a live source exists, then shows the plans.
   *
   * Most stores are seeded, so this often changes nothing. It still runs,
   * because silently skipping it would make the button a lie.
   */
  const onReady = () => {
    startTransition(async () => {
      try {
        const report = await refreshLiveOffersAction();
        // "No credentials" is a normal state, not a failure. Reporting it as an
        // error would make the default experience look broken.
        const realError = report.errors.find((message) => !/not configured/i.test(message));
        setRefreshNote(
          realError
            ? realError
            : report.updated > 0
              ? `${report.updated} live prices refreshed`
              : 'Priced from seeded data — no live sources connected',
        );
      } catch {
        setRefreshNote('Could not refresh live prices, using what we have');
      }
      router.refresh();
      setStep('choose');
    });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <StepBar step={step} />

      {step === 'review' && (
        <Panel>
          <PanelHeader
            title="Your list"
            hint={`${view.lineCount} lines · ${view.itemCount} items · comparing ${view.selectedStores.length} stores`}
          />
          <div className="px-5 py-5">
            <p className="text-[13px] leading-relaxed text-zinc-400">
              Hit ready and Cartwise prices your whole list at every store you selected, then shows you the options.
              Some will be a single stop, some will split across two or three stores, because prices genuinely differ.
            </p>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {view.selectedStores.map((store) => (
                <li key={store.id} className="rounded-lg border border-line bg-raised/50 px-2 py-1 text-[11px] text-zinc-400">
                  {store.banner}
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled={pending}
              onClick={onReady}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-[13px] font-semibold text-ink transition hover:bg-emerald-300 disabled:opacity-60"
            >
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ArrowRight className="size-4" aria-hidden />}
              {pending ? 'Pricing your list…' : "Ready — price my list"}
            </button>
          </div>
        </Panel>
      )}

      {step === 'choose' && (
        <>
          {refreshNote && <p className="text-[11px] text-zinc-500">{refreshNote}</p>}

          <Panel>
            <PanelHeader
              title="Pick your trip"
              hint="Every total buys your complete list. A cheaper option just costs you more stops."
            />
            <ul className="divide-y divide-line">
              {view.options.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    onClick={() => setChosenId(option.id)}
                    aria-pressed={option.id === chosenId}
                    className="flex w-full items-start gap-3 px-5 py-4 text-left transition hover:bg-raised/40"
                  >
                    <span
                      aria-hidden
                      className={clsx(
                        'mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-full border transition',
                        option.id === chosenId ? 'border-accent bg-accent text-ink' : 'border-line-bright',
                      )}
                    >
                      {option.id === chosenId && <Check className="size-3" strokeWidth={3} />}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                        <span className="text-[15px] font-semibold text-zinc-100">
                          {option.groups.map((group) => group.store.banner).join(' + ')}
                        </span>
                        {option.recommended && (
                          <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent ring-1 ring-inset ring-accent/25">
                            Recommended
                          </span>
                        )}
                        {option.savingsCents > 0 && (
                          <span className="text-[12px] font-semibold text-accent tnum">
                            saves <Money cents={option.savingsCents} />
                          </span>
                        )}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-zinc-500">
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" aria-hidden />
                          {option.label.toLowerCase()}
                        </span>
                        <span className="inline-flex items-center gap-1 tnum">
                          <Car className="size-3" aria-hidden />
                          {option.driveMinutes} min
                        </span>
                        {option.unavailable.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-rose-300/80">
                            <TriangleAlert className="size-3" aria-hidden />
                            missing {option.unavailable.map((item) => item.name).join(', ')}
                          </span>
                        )}
                      </span>
                    </span>

                    <span className="shrink-0 text-[17px] font-semibold text-zinc-100 tnum">
                      <Money cents={option.totalCents} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3.5">
              <button
                type="button"
                onClick={() => setStep('review')}
                className="text-[11px] font-medium text-zinc-500 hover:text-zinc-300"
              >
                Back to list
              </button>
              <button
                type="button"
                onClick={() => setStep('order')}
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-[13px] font-semibold text-ink transition hover:bg-emerald-300"
              >
                Approve this trip
                <ArrowRight className="size-4" aria-hidden />
              </button>
            </div>
          </Panel>
        </>
      )}

      {step === 'order' && chosen && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="eyebrow">Your trip</p>
              <p className="mt-1 text-lg font-semibold tracking-tight text-zinc-100">
                {chosen.groups.map((group) => group.store.banner).join('  →  ')}
              </p>
            </div>
            <p className="text-xl font-semibold text-accent tnum">
              <Money cents={chosen.totalCents} />
            </p>
          </div>

          {chosen.groups.map((group, position) => (
            <StoreOrderCard
              key={group.store.id}
              group={group}
              position={position + 1}
              krogerCart={view.krogerCart}
            />
          ))}

          <button
            type="button"
            onClick={() => setStep('choose')}
            className="text-[11px] font-medium text-zinc-500 hover:text-zinc-300"
          >
            Choose a different trip
          </button>
        </>
      )}
    </div>
  );
}

function StepBar({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: 'review', label: 'Your list' },
    { id: 'choose', label: 'Pick a trip' },
    { id: 'order', label: 'Order' },
  ];
  const activeIndex = steps.findIndex((entry) => entry.id === step);

  return (
    <ol className="flex items-center gap-2 text-[11px]">
      {steps.map((entry, index) => (
        <li key={entry.id} className="flex items-center gap-2">
          <span
            className={clsx(
              'flex items-center gap-1.5 rounded-lg px-2 py-1 font-medium transition',
              index === activeIndex
                ? 'bg-accent/10 text-accent ring-1 ring-inset ring-accent/25'
                : index < activeIndex
                  ? 'text-zinc-400'
                  : 'text-zinc-600',
            )}
          >
            {index < activeIndex && <Check className="size-3" aria-hidden />}
            {entry.label}
          </span>
          {index < steps.length - 1 && <span className="text-zinc-700">/</span>}
        </li>
      ))}
    </ol>
  );
}

/** One store's shopping list, plus the ways to actually order from it. */
function StoreOrderCard({
  group,
  position,
  krogerCart,
}: {
  group: TripStoreGroup;
  position: number;
  krogerCart: TripView['krogerCart'];
}) {
  const [copied, setCopied] = useState(false);
  const [cartNote, setCartNote] = useState<string | null>(null);
  const [pushing, startPush] = useTransition();

  // Kroger is the only store with a real, sanctioned cart-push API.
  const canPush = group.link?.chainId === 'kroger';

  const pushCart = () => {
    startPush(async () => {
      const result = await pushKrogerCartAction(
        group.store.id,
        group.lines.map((line) => ({ itemId: line.item.id, quantity: line.quantity })),
      );
      setCartNote(
        result.ok
          ? `Sent ${result.added} ${result.added === 1 ? 'item' : 'items'} to your cart` +
              (result.skipped > 0 ? ` · ${result.skipped} had no Kroger UPC yet` : '')
          : (result.reason ?? 'Cart push failed'),
      );
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(group.listText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the list is on screen either way.
      setCopied(false);
    }
  };

  return (
    <Panel>
      <PanelHeader
        title={`${position}. ${group.store.label}`}
        hint={`${group.lines.length} ${group.lines.length === 1 ? 'item' : 'items'} · ${group.store.driveMinutes} min · ${group.store.address}`}
        action={
          <span className="text-[15px] font-semibold text-zinc-100 tnum">
            <Money cents={group.subtotalCents} />
          </span>
        }
      />

      <ul className="divide-y divide-line/70">
        {group.lines.map((line) => (
          <li key={line.item.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-[13px]">
            <span className="min-w-0 flex-1">
              {line.searchUrl ? (
                <a
                  href={line.searchUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  title={`Find ${line.item.name} on ${group.store.banner}'s site`}
                  className="text-zinc-100 underline decoration-line-bright decoration-dotted underline-offset-2 hover:text-accent"
                >
                  {line.item.name}
                </a>
              ) : (
                <span className="text-zinc-100">{line.item.name}</span>
              )}
              {line.quantity > 1 && <span className="ml-1.5 text-zinc-400">×{line.quantity}</span>}
              <span className="ml-2 text-[11px] text-zinc-500">
                {line.productLabel} · {line.sizeLabel}
              </span>
              {line.forced && (
                <span className="ml-1.5 rounded bg-amber-500/10 px-1 py-0.5 text-[10px] font-medium text-amber-300 ring-1 ring-inset ring-amber-500/25">
                  detour
                </span>
              )}
            </span>
            <span className="w-16 text-right text-[11px] text-zinc-600 tnum">{line.unitPrice}</span>
            <span className="w-16 text-right font-medium text-zinc-100 tnum">
              <Money cents={line.lineTotalCents} />
            </span>
          </li>
        ))}
      </ul>

      {/* The actual point of this screen: get this list into that store. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3.5">
        {group.link ? (
          <a
            href={group.link.homeUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-[11px] font-semibold text-accent transition hover:bg-accent/15"
          >
            Order at {group.link.label}
            <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : (
          <span className="text-[11px] text-zinc-600">No online ordering for this store</span>
        )}

        {canPush &&
          (krogerCart.connected ? (
            <button
              type="button"
              disabled={pushing}
              onClick={pushCart}
              className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-[11px] font-semibold text-accent transition hover:bg-accent/15 disabled:opacity-50"
            >
              {pushing ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <ShoppingCart className="size-3" aria-hidden />}
              {pushing ? 'Sending…' : 'Send list to cart'}
            </button>
          ) : krogerCart.configured ? (
            <a
              href="/api/kroger/connect"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-raised/50 px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 transition hover:border-accent/40 hover:text-accent"
            >
              <ShoppingCart className="size-3" aria-hidden />
              Connect Kroger cart
            </a>
          ) : (
            <span className="text-[10px] text-zinc-600">Add Kroger API keys to enable cart push</span>
          ))}

        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-raised/50 px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 transition hover:border-line-bright"
        >
          <ClipboardCopy className="size-3" aria-hidden />
          {copied ? 'Copied' : 'Copy list'}
        </button>

        {cartNote && <span className="text-[10px] text-zinc-400">{cartNote}</span>}

        {group.link?.instacart && (
          <span className="text-[10px] text-zinc-600">
            Instacart storefront — prices there may include markup
          </span>
        )}
      </div>
    </Panel>
  );
}
