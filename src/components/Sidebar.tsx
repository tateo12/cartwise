'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import { Bell, LayoutDashboard, PackageOpen, Receipt, Route, ShoppingBasket, Store, Tags } from 'lucide-react';

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/basket', label: 'Basket', icon: ShoppingBasket },
  { href: '/trip', label: 'Shop the trip', icon: Route },
  { href: '/items', label: 'All prices', icon: Tags },
  { href: '/alerts', label: 'Watchlist', icon: Bell },
  { href: '/pantry', label: 'Pantry', icon: PackageOpen },
  { href: '/receipts', label: 'Receipts', icon: Receipt },
  { href: '/stores', label: 'My stores', icon: Store },
];

export interface SidebarLiveStatus {
  configured: boolean;
  liveOfferCount: number;
  lastRefreshedAt: string | null;
  liveHistoryPoints: number;
}

export function Sidebar({ live, storeCount }: { live: SidebarLiveStatus; storeCount: number }) {
  const pathname = usePathname();

  // Three distinct states. Collapsing "configured" into "live" is how the
  // sidebar previously claimed live prices while serving seeded ones.
  const hasLive = live.liveOfferCount > 0;
  const dotClass = hasLive ? 'bg-accent' : live.configured ? 'bg-sky-400' : 'bg-amber-400';
  const label = hasLive
    ? `${live.liveOfferCount} live Kroger prices`
    : live.configured
      ? 'Kroger connected — not fetched'
      : 'All seeded prices';

  return (
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className="px-2 py-3">
        <p className="text-[15px] font-semibold tracking-tight text-zinc-100">Cartwise</p>
        <p className="mt-0.5 text-[11px] text-zinc-500">Salt Lake Valley</p>
      </div>

      <ul className="mt-1 space-y-0.5">
        {NAV.map((entry) => {
          const active = pathname === entry.href;
          const Icon = entry.icon;
          return (
            <li key={entry.href}>
              <Link
                href={entry.href}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition',
                  active ? 'bg-raised text-zinc-100 ring-1 ring-inset ring-line-bright' : 'text-zinc-400 hover:bg-raised/60 hover:text-zinc-200',
                )}
              >
                <Icon className={clsx('size-4', active ? 'text-accent' : 'text-zinc-500')} aria-hidden />
                {entry.label}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto space-y-2 px-2 pb-1 pt-4">
        <div className="rounded-lg border border-line bg-surface/80 px-2.5 py-2">
          <p className="eyebrow">Price sources</p>
          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-zinc-400">
            <span className={clsx('size-1.5 rounded-full', dotClass)} aria-hidden />
            {label}
          </p>
          {!live.configured && (
            <p className="mt-1 text-[10px] leading-snug text-zinc-600">
              Add Kroger API keys to <span className="font-mono">.env.local</span> for real Smith’s prices.
            </p>
          )}
          {live.configured && !hasLive && (
            <p className="mt-1 text-[10px] leading-snug text-zinc-600">
              Hit <span className="text-zinc-500">Refresh live prices</span> on My stores.
            </p>
          )}
          {hasLive && live.lastRefreshedAt && (
            <p className="mt-1 text-[10px] leading-snug text-zinc-600">
              Fetched {live.lastRefreshedAt.slice(0, 16).replace('T', ' ')}
            </p>
          )}
        </div>
        <p className="px-0.5 text-[10px] text-zinc-600">
          Comparing {storeCount} selected {storeCount === 1 ? 'store' : 'stores'}
        </p>
      </div>
    </nav>
  );
}
