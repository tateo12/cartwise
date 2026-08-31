import Link from 'next/link';
import { clsx } from 'clsx';
import type { MatchConfidence, Provenance, StockLevel } from '@/core/domain';
import { VERDICT_LABEL, VERDICT_TONE, type DealVerdict } from '@/core/history';

/** Shared presentational primitives. No data access, no state. */

export function Panel({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={clsx('panel', className)}>{children}</section>;
}

export function PanelHeader({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
      <div>
        <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
      </div>
      {action}
    </header>
  );
}

export function Money({ cents, className, sign }: { cents: number; className?: string; sign?: boolean }) {
  const prefix = sign && cents > 0 ? '+' : cents < 0 ? '−' : '';
  return (
    <span className={clsx('tnum', className)}>
      {prefix}${(Math.abs(cents) / 100).toFixed(2)}
    </span>
  );
}

/**
 * Where a price came from. Required on every displayed price — a seeded number
 * must never be mistakable for a live one (ADR 0003).
 */
export function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  const config: Record<Provenance, { label: string; tone: string; title: string }> = {
    live: {
      label: 'Live',
      tone: 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/30',
      title: 'Fetched from the retailer’s official API',
    },
    seed: {
      label: 'Seed',
      tone: 'text-amber-300/90 bg-amber-500/10 ring-amber-500/25',
      title: 'Realistic placeholder — this chain has no public price API',
    },
    user: {
      label: 'You',
      tone: 'text-sky-300 bg-sky-500/10 ring-sky-500/25',
      title: 'Recorded by you from a receipt',
    },
  };
  const { label, tone, title } = config[provenance];
  return (
    <span title={title} className={clsx('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset', tone)}>
      {label}
    </span>
  );
}

/** How much we trust that this Product is really the Item you asked for. */
export function ConfidenceBadge({ confidence }: { confidence: MatchConfidence }) {
  const config: Record<MatchConfidence, { label: string; tone: string; title: string }> = {
    pinned: {
      label: 'Pinned',
      tone: 'text-violet-300 bg-violet-500/10 ring-violet-500/30',
      title: 'You confirmed this match — it overrides the matcher',
    },
    high: {
      label: 'Exact',
      tone: 'text-emerald-300/90 bg-emerald-500/8 ring-emerald-500/25',
      title: 'Same barcode across stores — provably the identical product',
    },
    medium: {
      label: 'Similar',
      tone: 'text-zinc-400 bg-zinc-500/10 ring-zinc-500/25',
      title: 'Store brands matched by size and category — a claim, not a fact',
    },
    unmatched: {
      label: 'Unmatched',
      tone: 'text-rose-300 bg-rose-500/10 ring-rose-500/25',
      title: 'Not yet matched to any item',
    },
  };
  const { label, tone, title } = config[confidence];
  return (
    <span title={title} className={clsx('rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset', tone)}>
      {label}
    </span>
  );
}

export function VerdictBadge({ verdict }: { verdict: DealVerdict }) {
  return (
    <span className={clsx('rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset', VERDICT_TONE[verdict])}>
      {VERDICT_LABEL[verdict]}
    </span>
  );
}

export function StockNote({ stock }: { stock: StockLevel }) {
  if (stock === 'out_of_stock') return <span className="text-[10px] font-medium text-rose-300">out of stock</span>;
  if (stock === 'low') return <span className="text-[10px] font-medium text-amber-300/90">low stock</span>;
  return null;
}

export function StatTile({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  detail?: string;
  tone?: 'default' | 'good' | 'warn';
}) {
  const valueTone = {
    default: 'text-zinc-100',
    good: 'text-emerald-300',
    warn: 'text-amber-300',
  }[tone];
  return (
    <div className="panel px-4 py-3.5">
      <p className="eyebrow">{label}</p>
      <p className={clsx('mt-1.5 text-2xl font-semibold tnum', valueTone)}>{value}</p>
      {detail && <p className="mt-0.5 text-xs text-zinc-500">{detail}</p>}
    </div>
  );
}

export function EmptyState({ title, body, cta }: { title: string; body: string; cta?: { href: string; label: string } }) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="text-sm font-medium text-zinc-300">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-zinc-500">{body}</p>
      {cta && (
        <Link
          href={cta.href}
          className="mt-4 inline-block rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-emerald-300"
        >
          {cta.label}
        </Link>
      )}
    </div>
  );
}

/**
 * The struck-through "was" price.
 *
 * Renders ONLY when the reference price is genuinely higher than what you pay.
 * A strikethrough showing less than the current price is worse than no
 * strikethrough at all — it reads as a price rise dressed up as a saving.
 */
export function WasPrice({
  regularCents,
  currentCents,
  quantity = 1,
}: {
  regularCents: number | null;
  currentCents: number;
  quantity?: number;
}) {
  if (regularCents == null || regularCents <= currentCents) return null;
  return (
    <p className="text-[11px] text-zinc-500 tnum">
      was <span className="line-through">${((regularCents * quantity) / 100).toFixed(2)}</span>
    </p>
  );
}

/**
 * A product's brand, with the redundant case collapsed.
 *
 * A store brand's name IS the banner ("WinCo Foods" at WinCo Foods), so
 * printing both wastes a column. A house brand under a different banner
 * (Kroger at Smith's, Kirkland at Costco) is genuinely informative and stays.
 */
export function ProductBrand({ brand, banner }: { brand: string; banner: string }) {
  if (brand === banner) return <span className="text-zinc-500 italic">store brand</span>;
  return <span className="text-zinc-300">{brand}</span>;
}
