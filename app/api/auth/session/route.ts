// =============================================================================
// GET /api/auth/session
// =============================================================================
// Returns the current user when the request includes a valid JWT session cookie.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getUserById } from '@/lib/repositories/users';

/**
 * Handles GET requests for this route.
 * @param req - The incoming request object.
 * @returns A response describing the request result.
 */
export async function GET(req: NextRequest) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    return NextResponse.json({
      $id: user.userId,
      email: user.email,
    });
  } catch (err) {
    console.error('[GET /api/auth/session]', err);
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
}
