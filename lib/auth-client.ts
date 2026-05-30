// =============================================================================
// CLIENT-SIDE AUTH HELPERS
// =============================================================================
// Thin fetch wrappers around server auth routes.
// =============================================================================

/**
 * Kept for backward compatibility with OAuth callback pages.
 * No local cookie fallback is used in JWT mode.
 */
export function clearCookieFallback(): void {
  // no-op
}

/**
 * Login with email and password via API route.
 */
export async function loginWithEmail(email: string, password: string): Promise<{ ok: true }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    let message = 'Login failed';
    try {
      const data = (await res.json()) as { error?: string };
      if (typeof data.error === 'string' && data.error.trim() !== '') {
        message = data.error;
      }
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }

  return { ok: true };
}

/**
 * Logout via API route; this clears the session cookie.
 */
export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
}

/**
 * Get current user session.
 * Returns null if no active session exists.
 */
export async function getCurrentSession(): Promise<{ $id?: string; email?: string } | null> {
  try {
    const res = await fetch('/api/auth/session', {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) return null;
    return (await res.json()) as { $id?: string; email?: string };
  } catch {
    return null;
  }
}

/**
 * Get current authenticated user.
 * Returns null if no user is logged in.
 */
export async function getCurrentUser(): Promise<{ $id?: string; email?: string } | null> {
  return getCurrentSession();
}
