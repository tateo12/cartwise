'use client';

import { useEffect, useState, useTransition } from 'react';
import { Fuel, Home, Loader2, RefreshCw } from 'lucide-react';
import {
  refreshFuelPriceAction,
  setFuelPriceAction,
  setHomeAction,
  setMpgAction,
  setVehicleAction,
  vehicleMakesAction,
  vehicleModelsAction,
  vehicleTrimsAction,
  vehicleYearsAction,
} from '@/app/actions';
import type { MenuOption } from '@/providers/fuelEconomy';
import type { TripSettings } from '@/db/queries';
import { Panel, PanelHeader } from '@/components/ui';

/**
 * Home, vehicle and fuel price — the three inputs to the "is a detour worth it"
 * calculation.
 *
 * All three are per-user and two of them change over time, so none of them can
 * be a constant baked into the app. MPG is set once from the EPA's own vehicle
 * database; the fuel price is refreshed from the EPA and overridable, because a
 * national average is not your local pump.
 */
export function TripSettingsPanel({ settings }: { settings: TripSettings }) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  const [address, setAddress] = useState('');
  const [manualPrice, setManualPrice] = useState((settings.fuelPriceCents / 100).toFixed(2));
  const [manualMpg, setManualMpg] = useState(String(settings.mpg));

  const [years, setYears] = useState<MenuOption[]>([]);
  const [makes, setMakes] = useState<MenuOption[]>([]);
  const [models, setModels] = useState<MenuOption[]>([]);
  const [trims, setTrims] = useState<MenuOption[]>([]);
  const [year, setYear] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');

  // Years load once; each later step loads only when its parent is chosen.
  useEffect(() => {
    vehicleYearsAction().then(setYears).catch(() => setYears([]));
  }, []);

  const run = (work: () => Promise<string | null>) => {
    setNote(null);
    startTransition(async () => {
      try {
        setNote(await work());
      } catch (error) {
        setNote(error instanceof Error ? error.message : 'That did not work.');
      }
    });
  };

  return (
    <Panel>
      <PanelHeader
        title="Home, car and fuel"
        hint="These drive the distance and fuel figures behind every savings number"
      />

      <div className="space-y-5 px-5 py-4">
        {/* ── Home ─────────────────────────────────────────────────────── */}
        <div>
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-zinc-200">
            <Home className="size-3.5 text-zinc-500" aria-hidden />
            Home
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {settings.homeIsSet
              ? (settings.homeLabel ?? `${settings.home.lat.toFixed(4)}, ${settings.home.lon.toFixed(4)}`)
              : 'Not set — distances are measured from downtown Salt Lake, so they are not yours yet.'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Street address, cross-streets, or ZIP"
              className="min-w-0 flex-1 rounded-lg border border-line bg-ink/50 px-2.5 py-1.5 text-[12px] text-zinc-200 placeholder:text-zinc-600 focus:border-line-bright focus:outline-none"
            />
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const result = await setHomeAction(address);
                  return result.ok ? `Home set to ${result.label}` : (result.reason ?? 'Could not set home.');
                })
              }
              className="rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-[11px] font-semibold text-accent transition hover:bg-accent/15 disabled:opacity-50"
            >
              Set home
            </button>
          </div>
        </div>

        {/* ── Vehicle ──────────────────────────────────────────────────── */}
        <div>
          <p className="text-[12px] font-semibold text-zinc-200">Vehicle</p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {settings.vehicleIsSet
              ? `${settings.vehicleLabel ?? 'Set'} · ${settings.mpg} mpg combined`
              : `Not set — using a generic ${settings.mpg} mpg. A 45 mpg car changes most of these answers.`}
          </p>

          <div className="mt-2 flex flex-wrap gap-2">
            <select
              value={year}
              onChange={(event) => {
                setYear(event.target.value);
                setMake('');
                setModel('');
                setModels([]);
                setTrims([]);
                if (event.target.value) vehicleMakesAction(event.target.value).then(setMakes).catch(() => setMakes([]));
              }}
              className="rounded-lg border border-line bg-raised px-2 py-1.5 text-[12px] text-zinc-200"
            >
              <option value="">Year</option>
              {years.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>

            <select
              value={make}
              disabled={makes.length === 0}
              onChange={(event) => {
                setMake(event.target.value);
                setModel('');
                setTrims([]);
                if (event.target.value) vehicleModelsAction(year, event.target.value).then(setModels).catch(() => setModels([]));
              }}
              className="rounded-lg border border-line bg-raised px-2 py-1.5 text-[12px] text-zinc-200 disabled:opacity-40"
            >
              <option value="">Make</option>
              {makes.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>

            <select
              value={model}
              disabled={models.length === 0}
              onChange={(event) => {
                setModel(event.target.value);
                if (event.target.value) vehicleTrimsAction(year, make, event.target.value).then(setTrims).catch(() => setTrims([]));
              }}
              className="rounded-lg border border-line bg-raised px-2 py-1.5 text-[12px] text-zinc-200 disabled:opacity-40"
            >
              <option value="">Model</option>
              {models.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>

            <select
              disabled={trims.length === 0}
              onChange={(event) => {
                if (!event.target.value) return;
                run(async () => {
                  const result = await setVehicleAction(event.target.value);
                  return result.ok ? `${result.label} — ${result.mpg} mpg combined` : (result.reason ?? 'Lookup failed.');
                });
              }}
              className="rounded-lg border border-line bg-raised px-2 py-1.5 text-[12px] text-zinc-200 disabled:opacity-40"
            >
              <option value="">Engine / trim</option>
              {trims.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-zinc-600">or enter mpg directly</span>
            <input
              value={manualMpg}
              onChange={(event) => setManualMpg(event.target.value)}
              inputMode="decimal"
              className="w-20 rounded-lg border border-line bg-ink/50 px-2 py-1 text-[12px] text-zinc-200 focus:border-line-bright focus:outline-none"
            />
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  await setMpgAction(Number.parseFloat(manualMpg));
                  return `Set to ${manualMpg} mpg`;
                })
              }
              className="rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-zinc-300 transition hover:border-line-bright"
            >
              Save
            </button>
          </div>
        </div>

        {/* ── Fuel price ───────────────────────────────────────────────── */}
        <div>
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-zinc-200">
            <Fuel className="size-3.5 text-zinc-500" aria-hidden />
            Fuel price
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
            ${(settings.fuelPriceCents / 100).toFixed(2)}/gal ·{' '}
            {settings.fuelSource === 'manual'
              ? 'set by you'
              : settings.fuelSource === 'epa-national'
                ? `EPA national average${settings.fuelFetchedAt ? `, fetched ${settings.fuelFetchedAt.slice(0, 10)}` : ''}`
                : 'generic default, never refreshed'}
            {settings.fuelSource !== 'manual' && (
              <span className="text-zinc-600"> — a national average, not your local pump.</span>
            )}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const result = await refreshFuelPriceAction();
                  return result.ok
                    ? `Updated to $${((result.cents ?? 0) / 100).toFixed(2)}/gal`
                    : (result.reason ?? 'Could not refresh.');
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-[11px] font-semibold text-accent transition hover:bg-accent/15 disabled:opacity-50"
            >
              <RefreshCw className={pending ? 'size-3 animate-spin' : 'size-3'} aria-hidden />
              Get today&rsquo;s price
            </button>
            <span className="text-[11px] text-zinc-600">or</span>
            <input
              value={manualPrice}
              onChange={(event) => setManualPrice(event.target.value)}
              inputMode="decimal"
              className="w-20 rounded-lg border border-line bg-ink/50 px-2 py-1 text-[12px] text-zinc-200 focus:border-line-bright focus:outline-none"
            />
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  await setFuelPriceAction(Math.round(Number.parseFloat(manualPrice) * 100));
                  return `Set to $${manualPrice}/gal`;
                })
              }
              className="rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-zinc-300 transition hover:border-line-bright"
            >
              Use mine
            </button>
          </div>
        </div>

        {(pending || note) && (
          <p className="flex items-center gap-1.5 border-t border-line pt-3 text-[11px] text-zinc-400">
            {pending && <Loader2 className="size-3 animate-spin text-accent" aria-hidden />}
            {note}
          </p>
        )}
      </div>
    </Panel>
  );
}
