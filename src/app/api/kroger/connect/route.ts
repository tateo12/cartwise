import { NextResponse } from 'next/server';
import { buildAuthorizeUrl, redirectUri } from '@/providers/krogerCart';

/**
 * Starts the Kroger cart authorization.
 *
 * Sends you to Kroger to sign in and grant `cart.basic:write`. Kroger then
 * returns to `/api/kroger/callback` with a code.
 */
export async function GET(): Promise<NextResponse> {
  // `state` is CSRF protection: the callback rejects anything that doesn't match.
  const state = crypto.randomUUID();
  const url = buildAuthorizeUrl(state);

  if (!url) {
    return NextResponse.json(
      { error: 'Kroger credentials are not configured. Set KROGER_CLIENT_ID and KROGER_CLIENT_SECRET.' },
      { status: 400 },
    );
  }

  const response = NextResponse.redirect(url);
  response.cookies.set('kroger_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  // Surfaced in the callback error copy, since a mismatched redirect URI is the
  // single most common setup failure with Kroger's developer app.
  response.cookies.set('kroger_redirect_uri', redirectUri(), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 600 });
  return response;
}
