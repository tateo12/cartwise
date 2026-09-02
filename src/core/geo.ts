/**
 * Trip distance and fuel cost.
 *
 * The savings ladder is a decision about whether a detour pays for itself, and
 * that decision is wrong without the cost of the detour. "Saves $6.13" means
 * something different if the extra stop burns $2 of petrol.
 *
 * Distances here are ESTIMATES, and deliberately so. Real driving distance
 * needs a routing service; this uses great-circle distance scaled by a road
 * factor, which is close enough to choose between shopping trips and needs no
 * API, no key, and no network call. Every figure it produces is labelled as an
 * estimate in the UI rather than presented as a measured route.
 */

export interface Coordinates {
  lat: number;
  lon: number;
}

/**
 * Ratio of real road distance to straight-line distance.
 *
 * 1.3 is the widely used approximation for urban grids, and Salt Lake's grid is
 * about as regular as they come. It will be wrong in the mountains.
 */
const ROAD_FACTOR = 1.3;

const EARTH_RADIUS_MILES = 3958.8;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance in miles. */
export function haversineMiles(from: Coordinates, to: Coordinates): number {
  const dLat = toRadians(to.lat - from.lat);
  const dLon = toRadians(to.lon - from.lon);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);

  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Estimated road miles between two points. */
export function roadMiles(from: Coordinates, to: Coordinates): number {
  return haversineMiles(from, to) * ROAD_FACTOR;
}

/** All orderings of a list. Only ever called with 3 or fewer stops. */
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const result: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) result.push([items[i], ...tail]);
  }
  return result;
}

export interface RouteEstimate {
  /** Estimated round-trip road miles, home out and home again. */
  miles: number;
  /** Stop order that achieves it. */
  order: string[];
}

/**
 * Shortest round trip from home through every stop and back.
 *
 * This replaces summing each store's one-way drive time, which assumed you
 * drove home between every stop and therefore overstated multi-stop trips
 * badly. With at most three stops there are six orderings, so the optimum is
 * found exactly rather than approximated.
 */
export function bestRoute(home: Coordinates, stops: { id: string; at: Coordinates }[]): RouteEstimate {
  if (stops.length === 0) return { miles: 0, order: [] };

  let best: RouteEstimate | null = null;
  for (const ordering of permutations(stops)) {
    let miles = 0;
    let cursor = home;
    for (const stop of ordering) {
      miles += roadMiles(cursor, stop.at);
      cursor = stop.at;
    }
    miles += roadMiles(cursor, home);

    if (!best || miles < best.miles) best = { miles, order: ordering.map((stop) => stop.id) };
  }
  return best as RouteEstimate;
}

export interface VehicleSettings {
  /** Miles per gallon. */
  mpg: number;
  /** Fuel price in cents per gallon, e.g. 349 for $3.49. */
  fuelPriceCents: number;
}

export const DEFAULT_VEHICLE: VehicleSettings = {
  // US new-car average, near enough for a default the user can change.
  mpg: 25,
  fuelPriceCents: 349,
};

/** Fuel cost of a distance, in cents. */
export function fuelCostCents(miles: number, vehicle: VehicleSettings): number {
  if (vehicle.mpg <= 0) return 0;
  return Math.round((miles / vehicle.mpg) * vehicle.fuelPriceCents);
}

export interface TripCost {
  miles: number;
  fuelCents: number;
  order: string[];
}

export function tripCost(
  home: Coordinates,
  stops: { id: string; at: Coordinates }[],
  vehicle: VehicleSettings,
): TripCost {
  const route = bestRoute(home, stops);
  return { miles: route.miles, fuelCents: fuelCostCents(route.miles, vehicle), order: route.order };
}

/**
 * Whether a cheaper multi-stop plan actually beats the one-stop trip.
 *
 * `netSavingsCents` is the number that answers the user's real question. A plan
 * can save money on groceries and still lose once the driving is paid for, and
 * saying so is the entire point of showing it.
 */
export function netSaving(
  grocerySavingCents: number,
  baselineFuelCents: number,
  planFuelCents: number,
): { extraFuelCents: number; netSavingsCents: number; worthIt: boolean } {
  const extraFuelCents = planFuelCents - baselineFuelCents;
  const netSavingsCents = grocerySavingCents - extraFuelCents;
  return { extraFuelCents, netSavingsCents, worthIt: netSavingsCents > 0 };
}
