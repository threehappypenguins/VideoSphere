// =============================================================================
// GET /api/auth/session-role
// =============================================================================
// Used by proxy (middleware) for admin RBAC without importing node-appwrite
// Tables / lib/appwrite in the middleware bundle.
//
// Validates the session the same way as GET /api/auth/session, then loads
// `user_profiles.role` via the users repository (server route only).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { Client, Account } from 'node-appwrite';
import { getSessionCookieName } from '@/lib/auth-session-cookie';

/**
 * Handles GET requests for this route.
 * @param req - The incoming request object.
 * @returns A response describing the request result.
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
    const user = await account.get();

    let role: 'user' | 'admin' = 'user';
    try {
      const { getUserById } = await import('@/lib/repositories/users');
      const profile = await getUserById(user.$id);
      if (profile?.role === 'admin') role = 'admin';
    } catch (profileErr) {
      console.error('[GET /api/auth/session-role] profile lookup failed', profileErr);
      return NextResponse.json(
        { error: 'Profile unavailable', message: 'Could not load user profile' },
        { status: 503 }
      );
    }

    return NextResponse.json({ role });
  } catch (err) {
    console.error('[GET /api/auth/session-role]', err);
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
}
