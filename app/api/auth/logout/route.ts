// =============================================================================
// POST /api/auth/logout
// =============================================================================
// Deletes the Appwrite session via node-appwrite (client.setSession + account.deleteSession)
// and clears the httpOnly session cookie. Same pattern as GET /api/auth/session.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { Client, Account } from 'node-appwrite';
import { getSessionCookieName, getSessionCookieOptions } from '@/lib/auth-session-cookie';

export async function POST(req: NextRequest) {
  const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
  const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
  const cookieName = projectId ? getSessionCookieName(projectId) : null;
  const sessionSecret = cookieName ? req.cookies.get(cookieName)?.value : null;

  if (endpoint && projectId && sessionSecret) {
    try {
      const client = new Client()
        .setEndpoint(endpoint)
        .setProject(projectId)
        .setSession(sessionSecret);
      const account = new Account(client);
      await account.deleteSession('current');
    } catch (err) {
      console.error('[POST /api/auth/logout] delete session', err);
      // Still clear cookie so client is logged out even if Appwrite call failed
    }
  }

  const res = NextResponse.json({ ok: true }, { status: 200 });
  if (cookieName && projectId) {
    res.cookies.set(cookieName, '', {
      ...getSessionCookieOptions(),
      maxAge: 0,
    });
  }
  return res;
}
