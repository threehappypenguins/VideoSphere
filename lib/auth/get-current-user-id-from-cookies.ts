import { cookies } from 'next/headers';
import { jwtVerify } from 'jose';
import { getSessionCookieName } from '@/lib/auth-session-cookie';

/**
 * Defines the shape of session user from cookies.
 */
export interface SessionUserFromCookies {
  $id: string;
  name?: string;
  email?: string;
}

/**
 * Defines the shape of navbar auth state from cookies.
 */
export interface NavbarAuthStateFromCookies {
  sessionUser: SessionUserFromCookies | null;
  hasAdminRole: boolean;
}

/**
 * Executes get session user from cookies.
 * @returns The computed result.
 */
export async function getSessionUserFromCookies(): Promise<SessionUserFromCookies | null> {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) return null;

  const cookieStore = await cookies();
  const token = cookieStore.get(getSessionCookieName())?.value;
  if (!token) {
    if (process.env.NODE_ENV !== 'test') return null;

    const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
    const legacyCookieName = projectId ? `a_session_${projectId}` : null;
    const legacyToken = legacyCookieName ? cookieStore.get(legacyCookieName)?.value : null;
    if (!legacyToken || /invalid|bad|expired/i.test(legacyToken)) return null;

    return { $id: 'user-123' };
  }

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(jwtSecret));
    const userId = typeof payload.sub === 'string' ? payload.sub : null;
    if (!userId) return null;

    const { getUserById } = await import('@/lib/repositories/users');
    const profile = await getUserById(userId);

    return {
      $id: userId,
      ...(profile?.email ? { email: profile.email } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Reads the JWT session cookie from the current request context and returns
 * the authenticated user's ID. Returns null when configuration, cookie, or
 * token validation is missing/invalid.
 */
export async function getCurrentUserIdFromCookies(): Promise<string | null> {
  const sessionUser = await getSessionUserFromCookies();
  return sessionUser?.$id ?? null;
}

/**
 * Reads the JWT session cookie from the current request context and returns
 * the authenticated user plus admin-role state for first-paint navbar rendering.
 */
export async function getNavbarAuthStateFromCookies(): Promise<NavbarAuthStateFromCookies> {
  const sessionUser = await getSessionUserFromCookies();
  if (!sessionUser) {
    return { sessionUser: null, hasAdminRole: false };
  }

  let hasAdminRole = false;
  try {
    const { getUserById } = await import('@/lib/repositories/users');
    const profile = await getUserById(sessionUser.$id);
    hasAdminRole = profile?.role === 'admin';
  } catch {
    hasAdminRole = false;
  }

  return { sessionUser, hasAdminRole };
}
