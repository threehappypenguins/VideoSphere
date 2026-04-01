// =============================================================================
// GET /api/auth/onboarding-state
// POST /api/auth/onboarding-state
// =============================================================================
// Manage onboarding state persisted to Appwrite user_profiles.
// GET: Returns { hasCompletedOnboarding: boolean }
// POST: Updates hasCompletedOnboarding, returns updated state
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getUserById, updateUser } from '@/lib/repositories/users';

/**
 * GET /api/auth/onboarding-state
 * Returns the current user's onboarding completion state.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Fetch user profile with onboarding state
    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    return NextResponse.json(
      { hasCompletedOnboarding: user.hasCompletedOnboarding },
      { status: 200 }
    );
  } catch (err) {
    console.error('[GET /api/auth/onboarding-state]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/auth/onboarding-state
 * Updates the current user's onboarding completion state.
 * Body: { hasCompletedOnboarding: boolean }
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    if (body === null || typeof body !== 'object') {
      return NextResponse.json({ error: 'Body must be a JSON object.' }, { status: 400 });
    }

    const { hasCompletedOnboarding: rawHasCompleted } = body as Record<string, unknown>;

    if (typeof rawHasCompleted !== 'boolean') {
      return NextResponse.json(
        { error: 'hasCompletedOnboarding must be a boolean.' },
        { status: 400 }
      );
    }

    // Update user profile
    const updatedUser = await updateUser(userId, {
      hasCompletedOnboarding: rawHasCompleted,
    });

    return NextResponse.json(
      { hasCompletedOnboarding: updatedUser.hasCompletedOnboarding },
      { status: 200 }
    );
  } catch (err) {
    console.error('[POST /api/auth/onboarding-state]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
