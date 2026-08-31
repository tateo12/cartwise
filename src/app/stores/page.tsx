import { RefreshLiveButton } from '@/components/RefreshLiveButton';
import { StoreSelector } from '@/components/StoreSelector';
import { Panel, PanelHeader } from '@/components/ui';
import { CHAINS } from '@/data/stores';
import { liveStatus } from '@/db/live';
import { allStores, selectedStoreIds } from '@/db/queries';

export const dynamic = 'force-dynamic';

export default function StoresPage() {
  const stores = allStores();
  const selected = selectedStoreIds();
  const providerByChain = Object.fromEntries(CHAINS.map((c) => [c.id, c.provider])) as Record<string, 'kroger' | 'seed'>;
  const live = liveStatus();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-zinc-100">My stores</h1>
        <p className="mt-1 text-[13px] text-zinc-500">
          These are the only stores Cartwise compares. A store you haven&rsquo;t selected never appears in a total,
          even if it&rsquo;s cheaper.
        </p>
      </div>

      <Panel>
        <PanelHeader title="Salt Lake Valley" hint="Drive times are one-way from home" />
        <StoreSelector stores={stores} selected={selected} providerByChain={providerByChain} />
      </Panel>

      <Panel className="px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-[13px] font-semibold text-zinc-200">Live prices</h2>
          <RefreshLiveButton configured={live.configured} />
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
          {live.configured
            ? live.liveOfferCount > 0
              ? `${live.liveOfferCount} offers currently hold real Kroger prices. Anything Kroger can’t price keeps its seeded value, still badged Seed.`
              : 'Kroger credentials are configured but no live prices have been fetched yet — every price below is still seeded.'
            : 'No Kroger credentials configured, so every price in the app is seeded. Add them to .env.local to enable real Smith’s prices.'}
        </p>
        {live.liveOfferCount > 0 && live.liveHistoryPoints < 30 && (
          <p className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 text-[11px] leading-relaxed text-amber-100/80">
            Only {live.liveHistoryPoints} live price {live.liveHistoryPoints === 1 ? 'point has' : 'points have'} been
            recorded so far, so &ldquo;Real low&rdquo; and &ldquo;Fake sale&rdquo; verdicts on live prices are still being
            judged against seeded history. They become meaningful as live points accumulate — one per refresh per day.
          </p>
        )}
      </Panel>

      <Panel className="px-5 py-4">
        <h2 className="text-[13px] font-semibold text-zinc-200">Why some stores say &ldquo;Seeded&rdquo;</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
          Kroger (and therefore Smith&rsquo;s) publishes an official, free price API, so those prices can be real.
          Harmons, WinCo, Walmart, Costco, Target, Sprouts and Trader Joe&rsquo;s publish nothing comparable — their
          numbers here are realistic placeholders, badged <span className="font-medium text-amber-300/90">Seed</span>{' '}
          everywhere they appear. Every price in this app tells you which kind it is.
        </p>
      </Panel>
    </div>
  );
}
