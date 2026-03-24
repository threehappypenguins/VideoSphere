import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/admin-auth';
import { listUsers } from '@/lib/repositories/users';
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

export async function GET(request: NextRequest) {
  const adminCheck = await requireAdmin(request, '[GET /api/admin/users]');
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
