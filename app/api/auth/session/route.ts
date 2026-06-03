// =============================================================================
// GET /api/auth/session
// =============================================================================
// Returns the current user when the request includes a valid JWT session cookie.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { getTotpEnabledById } from '@/lib/repositories/users';

/**
 * Handles GET requests for this route.
 * @param req - The incoming request object.
 * @returns A response describing the request result.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let totpEnabled = false;
    try {
      totpEnabled = await getTotpEnabledById(user.userId);
    } catch (totpErr) {
      console.error('[GET /api/auth/session] TOTP status lookup failed', totpErr);
    }

    return NextResponse.json({
      $id: user.userId,
      email: user.email,
      name: user.name,
      authProvider: user.authProvider,
      totpEnabled,
    });
  } catch (err) {
    console.error('[GET /api/auth/session]', err);
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
}
