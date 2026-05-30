// =============================================================================
// GET /api/auth/session-role
// =============================================================================
// Used by middleware-side RBAC checks and navbar role hydration.
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
    const profile = await getUserById(userId);
    if (!profile) {
      return NextResponse.json(
        { error: 'Profile unavailable', message: 'Could not load user profile' },
        { status: 503 }
      );
    }

    const role: 'user' | 'admin' = profile.role === 'admin' ? 'admin' : 'user';
    return NextResponse.json({ role });
  } catch (profileErr) {
    console.error('[GET /api/auth/session-role] profile lookup failed', profileErr);
    return NextResponse.json(
      { error: 'Profile unavailable', message: 'Could not load user profile' },
      { status: 503 }
    );
  }
}
