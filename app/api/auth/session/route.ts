// =============================================================================
// GET /api/auth/session
// =============================================================================
// Returns the current user when the request includes a valid JWT session cookie.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedSessionUser } from '@/lib/api/auth';
import { resolveUserClockFormat } from '@/lib/user-preferences';

/**
 * Handles GET requests for this route.
 * @param req - The incoming request object.
 * @returns A response describing the request result.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    return NextResponse.json({
      $id: user.userId,
      email: user.email,
      name: user.name,
      authProvider: user.authProvider,
      totpEnabled: user.totpEnabled,
      preferences: user.preferences,
      clockFormat: resolveUserClockFormat(user.preferences),
    });
  } catch (err) {
    console.error('[GET /api/auth/session]', err);
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
}
