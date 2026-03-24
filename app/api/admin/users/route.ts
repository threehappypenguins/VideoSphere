import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getUserById, listUsers } from '@/lib/repositories/users';

interface AdminUserRow {
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
): Promise<
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse<{ error: string; message: string; statusCode: number }> }
> {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Unauthorized', message: 'Not authenticated', statusCode: 401 },
        { status: 401 }
      ),
    };
  }

  const user = await getUserById(userId);
  if (!user || user.role !== 'admin') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Forbidden', message: 'Admin access required', statusCode: 403 },
        { status: 403 }
      ),
    };
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

    return NextResponse.json({ data: response });
  } catch (error) {
    console.error('[GET /api/admin/users]', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to load users', statusCode: 500 },
      { status: 500 }
    );
  }
}
