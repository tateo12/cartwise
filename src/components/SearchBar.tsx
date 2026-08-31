'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { useState } from 'react';

/**
 * The top-of-app search. Answers one question: "what's the cheapest place to
 * buy this, among the stores I've selected?"
 *
 * Submits via the router rather than a plain GET form so the query stays in the
 * URL (shareable, back-button friendly) without a full page reload.
 */
export function SearchBar() {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get('q') ?? '');

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const query = value.trim();
        router.push(query ? `/search?q=${encodeURIComponent(query)}` : '/search');
      }}
      className="relative w-full max-w-xl"
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" aria-hidden />
      <input
        type="search"
        name="q"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search an item — milk, coffee, olive oil…"
        aria-label="Search for the cheapest store for an item"
        className="w-full rounded-xl border border-line bg-raised/70 py-2 pl-9 pr-20 text-sm text-zinc-100 placeholder:text-zinc-600 transition focus:border-line-bright focus:bg-raised focus:outline-none"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 sm:block">
        Enter
      </kbd>
    </form>
  );
}
