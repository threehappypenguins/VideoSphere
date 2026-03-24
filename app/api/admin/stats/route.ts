import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { countActiveDrafts } from '@/lib/repositories/drafts';
import { getCurrentUsageMonth, getTotalUploadsForMonth } from '@/lib/repositories/upload-usage';
import { getUserById, getUserCounts } from '@/lib/repositories/users';
import type { ApiError, ApiResponse } from '@/types';

interface AdminStats {
  totalUsers: number;
  totalSupporters: number;
  uploadsThisMonth: number;
  activeDrafts: number;
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
    console.error('[GET /api/admin/stats] requireAdmin: getUserById failed', err);
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

  try {
    const month = getCurrentUsageMonth();
    const [userCounts, uploadsThisMonth, activeDrafts] = await Promise.all([
      getUserCounts(),
      getTotalUploadsForMonth(month),
      countActiveDrafts(),
    ]);

    const stats: AdminStats = {
      totalUsers: userCounts.totalUsers,
      totalSupporters: userCounts.totalSupporters,
      uploadsThisMonth,
      activeDrafts,
    };

    const body: ApiResponse<AdminStats> = { data: stats };
    return NextResponse.json(body);
  } catch (error) {
    console.error('[GET /api/admin/stats]', error);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to load admin stats',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
