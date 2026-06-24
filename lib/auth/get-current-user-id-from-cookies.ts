import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
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
 * Redirect targets for {@link requireAdminUserIdFromCookies}.
 */
export interface RequireAdminFromCookiesOptions {
  /** Path encoded into the login redirect when the session is missing. */
  loginRedirectPath?: string;
  /** Path for authenticated non-admins (defaults to `/dashboard`). */
  forbiddenRedirectPath?: string;
}

/**
 * Executes get session user from cookies.
 * @returns The computed result.
 */
export async function getSessionUserFromCookies(): Promise<SessionUserFromCookies | null> {
  // cookies() must be called unconditionally, before any other check, so
  // Next.js always registers this as dynamic-API usage. If JWT_SECRET were
  // checked first and missing at build time, this function would return
  // early without ever calling cookies() — Next would then have no signal
  // that the page is dynamic and could statically prerender it, baking in
  // a build-time "no session" result forever. See (dashboard)/layout.tsx.
  const cookieStore = await cookies();
  const token = cookieStore.get(getSessionCookieName())?.value;
  if (!token) {
    return null;
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) return null;

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(jwtSecret));
    const userId = typeof payload.sub === 'string' ? payload.sub : null;
    if (!userId) return null;

    const { getUserById } = await import('@/lib/repositories/users');
    const profile = await getUserById(userId);
    if (!profile) return null;

    return {
      $id: userId,
      ...(profile?.name ? { name: profile.name } : {}),
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

/**
 * Ensures the current request has an authenticated admin user.
 * Authoritative server-side check for admin-only pages; complements `proxy.ts` in Next.js 16.
 * @param options - Optional redirect targets when access is denied.
 * @returns The authenticated admin user's id.
 */
export async function requireAdminUserIdFromCookies(
  options: RequireAdminFromCookiesOptions = {}
): Promise<string> {
  const loginRedirectPath = options.loginRedirectPath ?? '/dashboard';
  const forbiddenRedirectPath = options.forbiddenRedirectPath ?? '/dashboard';

  // cookies() must be called before any early redirect/return — see the
  // comment in getSessionUserFromCookies() above for why ordering matters
  // for Next.js's static/dynamic rendering detection.
  const cookieStore = await cookies();
  const token = cookieStore.get(getSessionCookieName())?.value;
  if (!token) {
    redirect(`/login?redirect=${encodeURIComponent(loginRedirectPath)}`);
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    redirect(`/login?redirect=${encodeURIComponent(loginRedirectPath)}`);
  }

  let userId: string | null = null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(jwtSecret));
    userId = typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    userId = null;
  }

  if (!userId) {
    redirect(`/login?redirect=${encodeURIComponent(loginRedirectPath)}`);
  }

  let profile;
  try {
    const { getUserById } = await import('@/lib/repositories/users');
    profile = await getUserById(userId);
  } catch {
    redirect(forbiddenRedirectPath);
  }

  if (!profile) {
    redirect(`/login?redirect=${encodeURIComponent(loginRedirectPath)}`);
  }

  if (profile.role !== 'admin') {
    redirect(forbiddenRedirectPath);
  }

  return userId;
}
