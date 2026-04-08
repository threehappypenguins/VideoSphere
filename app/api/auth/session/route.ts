// =============================================================================
// GET /api/auth/session
// =============================================================================
// Returns the current user when the request includes the app's session cookie.
// Uses node-appwrite Client.setSession(cookie) then Account.get() — same
// pattern as the tutorial's createSessionClient(). No raw cookie forwarding.
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
    return NextResponse.json(user);
  } catch (err) {
    console.error('[GET /api/auth/session]', err);
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
}
