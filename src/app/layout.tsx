import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import './globals.css';
import { Sidebar } from '@/components/Sidebar';
import { SearchBar } from '@/components/SearchBar';
import { MobileNav } from '@/components/MobileNav';
import { selectedStoreIds } from '@/db/queries';
import { liveStatus } from '@/db/live';

export const metadata: Metadata = {
  title: 'Cartwise — grocery price comparison',
  description: 'Where to shop in the Salt Lake Valley to spend the least on what you actually buy.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  // Makes "Add to Home Screen" launch without browser chrome on iOS.
  appleWebApp: { capable: true, title: 'Cartwise', statusBarStyle: 'black-translucent' },
};

/**
 * `viewportFit: 'cover'` lets the layout reach under the notch, which is only
 * safe because the bottom nav pads itself with `env(safe-area-inset-bottom)`.
 */
export const viewport: Viewport = {
  themeColor: '#090e0b',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const storeCount = selectedStoreIds().length;
  const live = liveStatus();

  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen">
          <aside className="hidden w-56 shrink-0 border-r border-line bg-ink/60 lg:block">
            <div className="sticky top-0 h-screen">
              <Sidebar live={live} storeCount={storeCount} />
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-line bg-base/85 px-5 py-3 backdrop-blur">
              <Suspense fallback={<div className="h-9 w-full max-w-xl rounded-xl border border-line bg-raised/40" />}>
                <SearchBar />
              </Suspense>
            </header>

            <main className="min-w-0 flex-1 px-4 py-5 pb-24 sm:px-5 sm:py-6 lg:pb-6">{children}</main>
          </div>
        </div>
        <MobileNav />
      </body>
    </html>
  );
}
