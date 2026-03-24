// =============================================================================
// ADMIN API AUTH
// =============================================================================
// Shared RBAC for /api/admin/* routes: session + user_profiles.role === 'admin'.
// Keeps status codes, messages, and ApiError shape in one place.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getUserById } from '@/lib/repositories/users';
import type { ApiError } from '@/types';

export type RequireAdminResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse<ApiError> };

/**
 * @param logContext — Prefix for server logs (e.g. `[GET /api/admin/users]`).
 */
export async function requireAdmin(
  request: NextRequest,
  logContext: string
): Promise<RequireAdminResult> {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    const errRes: ApiError = {
      error: 'Unauthorized',
      message: 'Not authenticated',
      statusCode: 401,
    };
    return { ok: false, response: NextResponse.json(errRes, { status: 401 }) };
  }

  let user;
  try {
    user = await getUserById(userId);
  } catch (err) {
    console.error(`${logContext} requireAdmin: getUserById failed`, err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to verify admin access',
      statusCode: 500,
    };
    return { ok: false, response: NextResponse.json(errRes, { status: 500 }) };
  }

  if (!user || user.role !== 'admin') {
    const errRes: ApiError = {
      error: 'Forbidden',
      message: 'Admin access required',
      statusCode: 403,
    };
    return { ok: false, response: NextResponse.json(errRes, { status: 403 }) };
  }

  return { ok: true, userId };
}
