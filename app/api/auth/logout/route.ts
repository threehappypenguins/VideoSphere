// =============================================================================
// POST /api/auth/logout
// =============================================================================
// Stateless logout: clear the JWT session cookie.
// =============================================================================

import { NextResponse } from 'next/server';
import { getSessionCookieName, getSessionCookieOptions } from '@/lib/auth-session-cookie';

/**
 * Handles POST requests for this route.
 * @returns A response describing the request result.
 */
export async function POST() {
  const res = NextResponse.json({ ok: true }, { status: 200 });
  res.cookies.set(getSessionCookieName(), '', {
    ...getSessionCookieOptions(),
    maxAge: 0,
  });
  return res;
}
