/**
 * EPA fueleconomy.gov — official US fuel prices and vehicle MPG.
 *
 * Free, keyless, and government-published, which makes it the one price source
 * in this app that needs no credentials and no scraping. It solves both halves
 * of the fuel-cost problem:
 *
 *  - **Fuel price changes weekly**, so a hardcoded default goes stale fast. The
 *    $3.49 this app shipped with was $0.61 below the real figure.
 *  - **MPG is per-vehicle**, and the spread is enormous: 25 mpg versus 45 mpg
 *    changes the "is this detour worth it" answer on most trips.
 *
 * Honest limitation: the price is a NATIONAL average, not Utah's. It is far
 * better than a stale constant and the user can always override it, but it is
 * not a local pump price and the UI says which one it is showing.
 */

const BASE = 'https://www.fueleconomy.gov/ws/rest';
const REQUEST_TIMEOUT_MS = 12_000;

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${BASE}${path}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    // A failed lookup must leave the existing setting alone, never zero it.
    return null;
  }
}

/** EPA returns single-item menus as an object rather than an array. */
function asList<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export interface FuelPrices {
  /** Regular unleaded, in cents per gallon. */
  regularCents: number;
  midgradeCents: number | null;
  premiumCents: number | null;
  dieselCents: number | null;
}

function toCents(dollars: string | undefined): number | null {
  if (!dollars) return null;
  const value = Number.parseFloat(dollars);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/** Current national average pump prices. */
export async function fetchFuelPrices(): Promise<FuelPrices | null> {
  const data = await getJson<Record<string, string>>('/fuelprices');
  if (!data) return null;
  const regularCents = toCents(data.regular);
  if (regularCents == null) return null;
  return {
    regularCents,
    midgradeCents: toCents(data.midgrade),
    premiumCents: toCents(data.premium),
    dieselCents: toCents(data.diesel),
  };
}

export interface MenuOption {
  label: string;
  value: string;
}

interface MenuResponse {
  menuItem?: { text: string; value: string } | { text: string; value: string }[];
}

function toOptions(response: MenuResponse | null): MenuOption[] {
  return asList(response?.menuItem).map((item) => ({ label: item.text, value: item.value }));
}

export async function fetchYears(): Promise<MenuOption[]> {
  return toOptions(await getJson<MenuResponse>('/vehicle/menu/year'));
}

export async function fetchMakes(year: string): Promise<MenuOption[]> {
  return toOptions(await getJson<MenuResponse>(`/vehicle/menu/make?year=${encodeURIComponent(year)}`));
}

export async function fetchModels(year: string, make: string): Promise<MenuOption[]> {
  return toOptions(
    await getJson<MenuResponse>(
      `/vehicle/menu/model?year=${encodeURIComponent(year)}&make=${encodeURIComponent(make)}`,
    ),
  );
}

/** Trims. Their `value` is the vehicle id needed for the MPG lookup. */
export async function fetchTrims(year: string, make: string, model: string): Promise<MenuOption[]> {
  return toOptions(
    await getJson<MenuResponse>(
      `/vehicle/menu/options?year=${encodeURIComponent(year)}&make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`,
    ),
  );
}

export interface VehicleEconomy {
  label: string;
  /** Combined city/highway MPG — the right figure for mixed grocery runs. */
  combinedMpg: number;
  cityMpg: number | null;
  highwayMpg: number | null;
  fuelType: string | null;
}

interface VehicleResponse {
  year?: string;
  make?: string;
  model?: string;
  trany?: string;
  comb08?: string;
  city08?: string;
  highway08?: string;
  fuelType?: string;
}

/**
 * Fuel economy for one specific vehicle configuration.
 *
 * Uses the COMBINED rating rather than highway: a grocery trip is stop-start
 * town driving, so the highway figure would flatter the numbers and understate
 * what a detour really costs.
 */
export async function fetchVehicleEconomy(vehicleId: string): Promise<VehicleEconomy | null> {
  const data = await getJson<VehicleResponse>(`/vehicle/${encodeURIComponent(vehicleId)}`);
  if (!data) return null;

  const combined = Number.parseFloat(data.comb08 ?? '');
  if (!Number.isFinite(combined) || combined <= 0) return null;

  const city = Number.parseFloat(data.city08 ?? '');
  const highway = Number.parseFloat(data.highway08 ?? '');

  return {
    label: [data.year, data.make, data.model, data.trany].filter(Boolean).join(' '),
    combinedMpg: combined,
    cityMpg: Number.isFinite(city) ? city : null,
    highwayMpg: Number.isFinite(highway) ? highway : null,
    fuelType: data.fuelType ?? null,
  };
}
