import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/admin-auth';
import { listUsers } from '@/lib/repositories/users';
import type { ApiError, ApiResponse } from '@/types';

/**
 * Defines one user row returned by the admin users listing endpoint.
 */
export interface AdminUserRow {
  /** Stable id (auth user id / `user_profiles.userId`); use for client keys, not email. */
  userId: string;
  email: string;
  name?: string;
  role: 'user' | 'admin';
  createdAt: string;
  /** False for Google OAuth-only accounts that cannot receive password reset links. */
  canResetPassword: boolean;
}

/**
 * Defines the paginated admin users response payload.
 */
export interface AdminUsersResponse {
  users: AdminUserRow[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

/**
 * Handles GET requests for this route.
 * @param request - The incoming request object.
 * @returns A response describing the request result.
 */
export async function GET(request: NextRequest) {
  const adminCheck = await requireAdmin(request, '[GET /api/admin/users]');
  if (adminCheck.ok === false) return adminCheck.response;

  const searchParams = request.nextUrl.searchParams;
  const limit = Math.min(Math.max(parsePositiveInt(searchParams.get('limit'), 25), 1), 100);
  const offset = Math.max(parsePositiveInt(searchParams.get('offset'), 0), 0);

  try {
    const { users, total } = await listUsers({
      limit,
      offset,
      includePasswordResetEligibility: true,
    });
    const response: AdminUsersResponse = {
      users: users.map((user) => ({
        userId: user.userId,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.$createdAt,
        canResetPassword: user.canResetPassword ?? false,
      })),
      pagination: {
        limit,
        offset,
        total,
      },
    };

    const body: ApiResponse<AdminUsersResponse> = { data: response };
    return NextResponse.json(body);
  } catch (error) {
    console.error('[GET /api/admin/users]', error);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to load users',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
