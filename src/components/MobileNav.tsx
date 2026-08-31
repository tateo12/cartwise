'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import { LayoutDashboard, Route, ShoppingBasket, Store, Tags } from 'lucide-react';

/**
 * Bottom tab bar for phones.
 *
 * The sidebar is `hidden lg:block`, which meant a phone had no navigation at
 * all: you could load the dashboard and then were stuck there. This is the
 * standard PWA pattern and it sits above the home indicator via safe-area
 * padding, so it is not swallowed by the gesture bar on a notched iPhone.
 *
 * Five destinations, deliberately. A tab bar with more becomes unreadable at
 * phone widths, so this is the shortlist and the rest stay sidebar-only.
 */
const TABS = [
  { href: '/', label: 'Home', icon: LayoutDashboard },
  { href: '/trip', label: 'Trip', icon: Route },
  { href: '/basket', label: 'Basket', icon: ShoppingBasket },
  { href: '/items', label: 'Prices', icon: Tags },
  { href: '/stores', label: 'Stores', icon: Store },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-base/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="grid grid-cols-5">
        {TABS.map((tab) => {
          // Only "/" needs an exact match; the rest are section prefixes.
          const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition',
                  active ? 'text-accent' : 'text-zinc-500',
                )}
              >
                <Icon className="size-5" aria-hidden />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
