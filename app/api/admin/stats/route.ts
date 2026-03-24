import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/admin-auth';
import { countActiveDrafts } from '@/lib/repositories/drafts';
import { getCurrentUsageMonth, getTotalUploadsForMonth } from '@/lib/repositories/upload-usage';
import { getUserCounts } from '@/lib/repositories/users';
import type { ApiError, ApiResponse } from '@/types';

interface AdminStats {
  totalUsers: number;
  totalSupporters: number;
  uploadsThisMonth: number;
  activeDrafts: number;
}

export async function GET(request: NextRequest) {
  const adminCheck = await requireAdmin(request, '[GET /api/admin/stats]');
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
