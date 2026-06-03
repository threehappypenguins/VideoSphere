// =============================================================================
// API AUTH HELPER
// =============================================================================
// Shared server-side helper for Route Handlers that need to verify the
// authenticated user from the httpOnly JWT session cookie.
// =============================================================================

import { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { getSessionCookieName } from '@/lib/auth-session-cookie';
import type { User } from '@/types';
import type { SessionUser } from '@/lib/repositories/users';

async function getJwtAuthenticatedUserId(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(getSessionCookieName())?.value ?? null;
  if (!token) return null;

  const secret = process.env.JWT_SECRET;
  if (!secret) return null;

  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key);
  return typeof payload.sub === 'string' ? payload.sub : null;
}

async function getJwtAuthenticatedUser(req: NextRequest): Promise<User | null> {
  const userId = await getJwtAuthenticatedUserId(req);
  if (!userId) return null;

  const { getUserById } = await import('@/lib/repositories/users');
  return getUserById(userId);
}

async function getJwtAuthenticatedSessionUser(req: NextRequest): Promise<SessionUser | null> {
  const userId = await getJwtAuthenticatedUserId(req);
  if (!userId) return null;

  const { getUserSessionById } = await import('@/lib/repositories/users');
  return getUserSessionById(userId);
}

/**
 * Reads the JWT session cookie from the request and returns the authenticated
 * user profile. Returns null when the token is missing/invalid or the user no
 * longer exists.
 * @param req - The incoming request object.
 * @returns The authenticated user profile or null.
 */
export async function getAuthenticatedUser(req: NextRequest): Promise<User | null> {
  try {
    return await getJwtAuthenticatedUser(req);
  } catch {
    return null;
  }
}

/**
 * Reads the JWT session cookie from the request and returns the authenticated
 * user profile including session fields such as `totpEnabled`. Returns null
 * when the token is missing/invalid or the user no longer exists.
 * @param req - The incoming request object.
 * @returns The authenticated session user profile or null.
 */
export async function getAuthenticatedSessionUser(req: NextRequest): Promise<SessionUser | null> {
  try {
    return await getJwtAuthenticatedSessionUser(req);
  } catch {
    return null;
  }
}

/**
 * Reads the JWT session cookie from the request and returns the authenticated
 * token subject id without loading the user profile.
 * @param req - The incoming request object.
 * @returns The JWT subject id when the token is valid; otherwise null.
 */
export async function getAuthenticatedSessionUserId(req: NextRequest): Promise<string | null> {
  try {
    return await getJwtAuthenticatedUserId(req);
  } catch {
    return null;
  }
}

/**
 * Reads the JWT session cookie from the request and returns the authenticated
 * user id. Returns null when the token is missing or invalid.
 * @param req - The incoming request object.
 * @returns The authenticated user id if token and profile are valid; otherwise null.
 */
export async function getAuthenticatedUserId(req: NextRequest): Promise<string | null> {
  try {
    const user = await getJwtAuthenticatedUser(req);
    return user?.userId ?? null;
  } catch {
    return null;
  }
}
