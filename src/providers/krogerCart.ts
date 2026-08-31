import { all, run } from '@/db/index';

/**
 * Kroger cart push.
 *
 * `PUT /v1/cart/add` adds items to an **authenticated customer's** cart, so it
 * uses the OAuth2 authorization_code grant rather than client_credentials: you
 * sign in with your own Kroger account and grant `cart.basic:write` once, and
 * the resulting token lets Cartwise drop your whole list into your Smith's
 * pickup cart.
 *
 * This is a sanctioned, documented API. It is the only cart integration in this
 * app that is not a workaround.
 *
 * The hard requirement is a real Kroger UPC per item, which our seeded
 * store-brand products do not have. UPCs arrive only from a live price refresh
 * (see `providers/kroger.ts`, which records `sourceUpc`), so cart push works
 * for items a refresh has resolved and honestly reports the rest as skipped
 * rather than silently dropping them.
 */

const AUTHORIZE_URL = 'https://api.kroger.com/v1/connect/oauth2/authorize';
const TOKEN_URL = 'https://api.kroger.com/v1/connect/oauth2/token';
const CART_ADD_URL = 'https://api.kroger.com/v1/cart/add';

/** Scope needed to write to a customer's cart, per Kroger's Cart API docs. */
const SCOPE = 'cart.basic:write';
const REQUEST_TIMEOUT_MS = 15_000;
/** Kroger's documented modality values. */
export type Modality = 'PICKUP' | 'DELIVERY';

const PROVIDER = 'kroger';

function credentials(): { id: string; secret: string } | null {
  const id = process.env.KROGER_CLIENT_ID;
  const secret = process.env.KROGER_CLIENT_SECRET;
  if (!id || !secret) return null;
  return { id, secret };
}

/**
 * Must match a redirect URI registered on your Kroger developer app exactly,
 * including scheme, host, port and path.
 */
export function redirectUri(): string {
  return process.env.KROGER_REDIRECT_URI ?? 'http://localhost:3000/api/kroger/callback';
}

interface TokenRow {
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
}

function storedToken(): TokenRow | null {
  const rows = all<TokenRow>(
    'select access_token, refresh_token, expires_at from retailer_tokens where provider = ?',
    PROVIDER,
  );
  return rows[0] ?? null;
}

function saveToken(accessToken: string, refreshToken: string | null, expiresInSeconds: number): void {
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
  run(
    `insert into retailer_tokens (provider, access_token, refresh_token, expires_at, created_at)
     values (?,?,?,?,?)
     on conflict(provider) do update set
       access_token = excluded.access_token,
       refresh_token = coalesce(excluded.refresh_token, retailer_tokens.refresh_token),
       expires_at = excluded.expires_at`,
    PROVIDER,
    accessToken,
    refreshToken,
    expiresAt,
    new Date().toISOString(),
  );
}

export function disconnectKroger(): void {
  run('delete from retailer_tokens where provider = ?', PROVIDER);
}

export interface KrogerCartStatus {
  /** Client id and secret are present. */
  configured: boolean;
  /** A customer has authorised cart access. */
  connected: boolean;
  /** True when the stored token is past expiry and has no refresh token. */
  expired: boolean;
}

export function krogerCartStatus(): KrogerCartStatus {
  const configured = credentials() != null;
  const token = configured ? storedToken() : null;
  if (!token) return { configured, connected: false, expired: false };
  const expired = Date.parse(token.expires_at) <= Date.now() && !token.refresh_token;
  return { configured, connected: !expired, expired };
}

/** Builds the URL to send the user to so they can grant cart access. */
export function buildAuthorizeUrl(state: string): string | null {
  const creds = credentials();
  if (!creds) return null;
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', creds.id);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('state', state);
  return url.toString();
}

function basicAuth(creds: { id: string; secret: string }): string {
  return Buffer.from(`${creds.id}:${creds.secret}`).toString('base64');
}

async function postToken(body: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const creds = credentials();
  if (!creds) return { ok: false, reason: 'Kroger credentials are not configured.' };

  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth(creds)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { ok: false, reason: `Kroger token exchange failed: ${response.status} ${detail.slice(0, 120)}` };
    }

    const json = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!json.access_token) return { ok: false, reason: 'Kroger returned no access token.' };

    saveToken(json.access_token, json.refresh_token ?? null, json.expires_in ?? 1800);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `Kroger token request errored: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Exchanges the authorization code from the callback for tokens. */
export function exchangeAuthorizationCode(code: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
  });
  return postToken(params.toString());
}

/** Returns a usable access token, refreshing first when it has expired. */
async function accessToken(): Promise<string | null> {
  const token = storedToken();
  if (!token) return null;

  // Refresh a minute early rather than racing the expiry boundary.
  if (Date.parse(token.expires_at) > Date.now() + 60_000) return token.access_token;
  if (!token.refresh_token) return null;

  const refreshed = await postToken(
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refresh_token }).toString(),
  );
  return refreshed.ok ? (storedToken()?.access_token ?? null) : null;
}

export interface CartPushItem {
  /** Retailer UPC. Items without one cannot be pushed. */
  upc: string;
  quantity: number;
}

export interface CartPushResult {
  ok: boolean;
  /** Items actually sent. */
  added: number;
  /** Items with no known Kroger UPC, so unsendable. */
  skipped: number;
  reason?: string;
}

/**
 * Adds items to the signed-in customer's Kroger cart.
 *
 * Kroger's endpoint is all-or-nothing per request, so a rejected UPC fails the
 * whole call. Items are therefore filtered to those with a real UPC before
 * sending, and the count of skipped items is reported rather than hidden.
 */
export async function addToKrogerCart(
  items: CartPushItem[],
  modality: Modality = 'PICKUP',
): Promise<CartPushResult> {
  const sendable = items.filter((item) => item.upc.trim().length > 0 && item.quantity > 0);
  const skipped = items.length - sendable.length;

  if (sendable.length === 0) {
    return {
      ok: false,
      added: 0,
      skipped,
      reason: 'No items have a Kroger UPC yet. Refresh live prices first so Cartwise learns them.',
    };
  }

  const token = await accessToken();
  if (!token) {
    return { ok: false, added: 0, skipped, reason: 'Kroger cart is not connected. Authorise it first.' };
  }

  try {
    const response = await fetch(CART_ADD_URL, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: sendable.map((item) => ({ upc: item.upc, quantity: item.quantity, modality })),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    // A successful add returns 204 with no body.
    if (response.status === 204 || response.ok) {
      return { ok: true, added: sendable.length, skipped };
    }

    const detail = await response.text().catch(() => '');
    return {
      ok: false,
      added: 0,
      skipped,
      reason: `Kroger rejected the cart add: ${response.status} ${detail.slice(0, 160)}`,
    };
  } catch (error) {
    return {
      ok: false,
      added: 0,
      skipped,
      reason: `Cart add errored: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
