// =============================================================================
// GET /api/auth/profile
// =============================================================================
// Returns the authenticated user's profile from user_profiles, including
// isSupporter status. Requires a valid session cookie.
//
// Response: { userId, email, isSupporter, role, $createdAt, $updatedAt }
// Errors:   401 (not authenticated), 404 (profile not found), 500 (internal)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getUserById } from '@/lib/repositories/users';

export async function GET(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    return NextResponse.json(user);
  } catch (err) {
    console.error('[GET /api/auth/profile]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
