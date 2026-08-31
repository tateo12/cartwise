import { NextResponse, type NextRequest } from 'next/server';
import { exchangeAuthorizationCode } from '@/providers/krogerCart';

/**
 * Completes the Kroger cart authorization.
 *
 * Verifies the `state` cookie before exchanging the code, then sends you back to
 * the trip screen with the outcome in the query string so the UI can say plainly
 * what happened rather than failing silently.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const code = params.get('code');
  const state = params.get('state');
  const denied = params.get('error');

  const back = (query: string) => NextResponse.redirect(new URL(`/trip?${query}`, request.nextUrl.origin));

  if (denied) return back(`kroger=denied&detail=${encodeURIComponent(denied)}`);

  const expectedState = request.cookies.get('kroger_oauth_state')?.value;
  if (!expectedState || !state || state !== expectedState) {
    return back('kroger=badstate');
  }
  if (!code) return back('kroger=nocode');

  const result = await exchangeAuthorizationCode(code);
  const response = back(result.ok ? 'kroger=connected' : `kroger=failed&detail=${encodeURIComponent(result.reason)}`);
  response.cookies.delete('kroger_oauth_state');
  return response;
}
