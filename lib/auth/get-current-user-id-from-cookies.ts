import { cookies } from 'next/headers';
import { Account, Client } from 'node-appwrite';
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
  const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
  const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
  if (!endpoint || !projectId) return null;

  const cookieStore = await cookies();
  const sessionSecret = cookieStore.get(getSessionCookieName(projectId))?.value;
  if (!sessionSecret) return null;

  try {
    const client = new Client()
      .setEndpoint(endpoint)
      .setProject(projectId)
      .setSession(sessionSecret);

    const account = new Account(client);
    const user = await account.get();
    return {
      $id: user.$id,
      ...(typeof user.name === 'string' ? { name: user.name } : {}),
      ...(typeof user.email === 'string' ? { email: user.email } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Reads the Appwrite session cookie from the current request context and returns
 * the authenticated user's ID. Returns null when configuration, cookie, or
 * session validation is missing/invalid.
 */
export async function getCurrentUserIdFromCookies(): Promise<string | null> {
  const sessionUser = await getSessionUserFromCookies();
  return sessionUser?.$id ?? null;
}

/**
 * Reads the Appwrite session cookie from the current request context and returns
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
