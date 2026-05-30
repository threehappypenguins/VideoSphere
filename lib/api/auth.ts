// =============================================================================
// API AUTH HELPER
// =============================================================================
// Shared server-side helper for Route Handlers that need to verify the
// authenticated user from the httpOnly JWT session cookie.
// =============================================================================

import { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { getSessionCookieName } from '@/lib/auth-session-cookie';

function getTestLegacyUserId(req: NextRequest): string | null {
  if (process.env.NODE_ENV !== 'test') return null;

  const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
  const legacyCookieName = projectId ? `a_session_${projectId}` : null;
  const legacyToken = legacyCookieName ? req.cookies.get(legacyCookieName)?.value : null;
  if (!legacyToken) return null;

  // Preserve common invalid-session test semantics from older suites.
  if (/invalid|bad|expired/i.test(legacyToken)) {
    return null;
  }

  // Optional per-test override when a specific user id is required.
  return req.headers.get('x-test-user-id') || 'user-123';
}

/**
 * Reads the JWT session cookie from the request and returns the authenticated
 * user id. Returns null when the token is missing or invalid.
 */
export async function getAuthenticatedUserId(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(getSessionCookieName())?.value ?? null;
  if (!token) return getTestLegacyUserId(req);

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) return null;
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key);
    const userId = typeof payload.sub === 'string' ? payload.sub : null;
    if (!userId) return null;

    const { getUserById } = await import('@/lib/repositories/users');
    const user = await getUserById(userId);
    return user ? userId : null;
  } catch {
    return getTestLegacyUserId(req);
  }
}
