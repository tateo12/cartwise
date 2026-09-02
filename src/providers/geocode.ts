/**
 * Address to coordinates, via OpenStreetMap Nominatim.
 *
 * Free and keyless, but rate-limited by policy to one request per second with
 * an identifying User-Agent — both of which this respects. Used only when the
 * user sets their home address, so it fires once, not per page load.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const REQUEST_TIMEOUT_MS = 12_000;
/** Nominatim's usage policy requires a real identifying agent. */
const USER_AGENT = 'Cartwise/0.1 (personal grocery price comparison app)';

export interface GeocodeResult {
  lat: number;
  lon: number;
  /** Nominatim's canonical name for the place, for display. */
  label: string;
}

/**
 * Geocodes a free-text address.
 *
 * Returns null rather than a guess when nothing matches: a wrong home position
 * silently distorts every distance and fuel figure in the app.
 */
export async function geocodeAddress(query: string): Promise<GeocodeResult | null> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return null;

  const url = new URL(NOMINATIM);
  url.searchParams.set('q', trimmed);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'us');

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const results = (await response.json()) as { lat?: string; lon?: string; display_name?: string }[];
    const first = results[0];
    if (!first?.lat || !first?.lon) return null;

    const lat = Number.parseFloat(first.lat);
    const lon = Number.parseFloat(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    return { lat, lon, label: first.display_name ?? trimmed };
  } catch {
    return null;
  }
}
