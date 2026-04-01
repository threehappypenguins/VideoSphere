// =============================================================================
// GET /api/auth/onboarding-state
// POST /api/auth/onboarding-state
// =============================================================================
// Manage onboarding state persisted to Appwrite user_profiles.
// GET: Returns { hasCompletedOnboarding: boolean }
// POST: Updates hasCompletedOnboarding, returns updated state
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { Client, Account } from 'node-appwrite';
import { getSessionCookieName } from '@/lib/auth-session-cookie';
import { getUserById, updateUser } from '@/lib/repositories/users';

/**
 * GET /api/auth/onboarding-state
 * Returns the current user's onboarding completion state.
 */
export async function GET(req: NextRequest) {
  const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
  const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
  const cookieName = projectId ? getSessionCookieName(projectId) : null;
  const sessionSecret = cookieName ? req.cookies.get(cookieName)?.value : null;

  if (!endpoint || !projectId || !sessionSecret) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const client = new Client()
      .setEndpoint(endpoint)
      .setProject(projectId)
      .setSession(sessionSecret);

    const account = new Account(client);
    const authUser = await account.get();
    const userId = authUser.$id;

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
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
}

/**
 * POST /api/auth/onboarding-state
 * Updates the current user's onboarding completion state.
 * Body: { hasCompletedOnboarding: boolean }
 */
export async function POST(req: NextRequest) {
  const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
  const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
  const cookieName = projectId ? getSessionCookieName(projectId) : null;
  const sessionSecret = cookieName ? req.cookies.get(cookieName)?.value : null;

  if (!endpoint || !projectId || !sessionSecret) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
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

    const client = new Client()
      .setEndpoint(endpoint)
      .setProject(projectId)
      .setSession(sessionSecret);

    const account = new Account(client);
    const authUser = await account.get();
    const userId = authUser.$id;

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
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
}
