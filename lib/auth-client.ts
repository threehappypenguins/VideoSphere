// =============================================================================
// APPWRITE CLIENT-SIDE AUTH
// =============================================================================
// Session is set server-side (Route Handlers) via httpOnly cookie; no localStorage.
// getCurrentUser / getCurrentSession use the SDK and send the cookie (credentials).
// logout() calls POST /api/auth/logout to clear the server-set cookie.
// =============================================================================

import { Client, Account } from 'appwrite';

const COOKIE_FALLBACK_KEY = 'cookieFallback';

/** Remove Appwrite session from localStorage so we rely on cookie only (same-origin). */
export function clearCookieFallback(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(COOKIE_FALLBACK_KEY);
  } catch {
    // ignore
  }
}

// Initialize Appwrite client
const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!);

const account = new Account(client);

/**
 * Login with email and password (client fallback; prefer POST /api/auth/login).
 * Use the login API route so the session cookie is set server-side (SSR).
 */
export async function loginWithEmail(email: string, password: string) {
  try {
    try {
      await account.deleteSession('current');
    } catch {
      // ignore
    }
    const session = await account.createEmailPasswordSession(email, password);
    setTimeout(clearCookieFallback, 0);
    return session;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Login failed';
    throw new Error(errorMessage);
  }
}

/**
 * Logout: call API to delete session and clear cookie (SSR).
 */
export async function logout() {
  clearCookieFallback();
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch {
    // still clear local state
  }
}

/**
 * Get current user session
 * Returns null if no active session exists
 *
 * @returns Session object or null if not authenticated
 */
export async function getCurrentSession() {
  try {
    const session = await account.getSession('current');
    return session;
  } catch {
    // No active session
    return null;
  }
}

/**
 * Get current authenticated user
 * Returns null if no user is logged in
 *
 * @returns User object or null if not authenticated
 */
export async function getCurrentUser() {
  try {
    const user = await account.get();
    return user;
  } catch {
    // No authenticated user
    return null;
  }
}
