import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getUserById, listUsers } from '@/lib/repositories/users';
import type { ApiError, ApiResponse } from '@/types';

interface AdminUserRow {
  /** Stable id (Appwrite Auth user id / `user_profiles.userId`); use for client keys, not email. */
  userId: string;
  email: string;
  role: 'user' | 'admin';
  isSupporter: boolean;
  createdAt: string;
}

interface AdminUsersResponse {
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

async function requireAdmin(
  request: NextRequest
): Promise<{ ok: true; userId: string } | { ok: false; response: NextResponse<ApiError> }> {
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
    console.error('[GET /api/admin/users] requireAdmin: getUserById failed', err);
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

export async function GET(request: NextRequest) {
  const adminCheck = await requireAdmin(request);
  if (adminCheck.ok === false) return adminCheck.response;

  const searchParams = request.nextUrl.searchParams;
  const limit = Math.min(Math.max(parsePositiveInt(searchParams.get('limit'), 25), 1), 100);
  const offset = Math.max(parsePositiveInt(searchParams.get('offset'), 0), 0);

  try {
    const { users, total } = await listUsers({ limit, offset });
    const response: AdminUsersResponse = {
      users: users.map((user) => ({
        userId: user.userId,
        email: user.email,
        role: user.role,
        isSupporter: user.isSupporter,
        createdAt: user.$createdAt,
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
