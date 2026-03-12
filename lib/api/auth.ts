// =============================================================================
// API AUTH HELPER
// =============================================================================
// Shared server-side helper for Route Handlers that need to verify the
// authenticated user from the httpOnly Appwrite session cookie.
//
// Usage:
//   const userId = await getAuthenticatedUserId(req);
//   if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
// =============================================================================

import { NextRequest } from 'next/server';
import { Client, Account } from 'node-appwrite';
import { getSessionCookieName } from '@/lib/auth-session-cookie';

/**
 * Reads the Appwrite session cookie from the request, creates a scoped client,
 * and returns the authenticated user's ID. Returns null if the session is
 * missing or invalid (caller should respond with 401).
 */
export async function getAuthenticatedUserId(req: NextRequest): Promise<string | null> {
  const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
  const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
  const cookieName = projectId ? getSessionCookieName(projectId) : null;
  const sessionSecret = cookieName ? req.cookies.get(cookieName)?.value : null;

  if (!endpoint || !projectId || !sessionSecret) return null;

  try {
    const client = new Client()
      .setEndpoint(endpoint)
      .setProject(projectId)
      .setSession(sessionSecret);

    const account = new Account(client);
    const user = await account.get();
    return user.$id;
  } catch {
    return null;
  }
}
