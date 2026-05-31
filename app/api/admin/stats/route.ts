import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/admin-auth';
import { countActiveDrafts } from '@/lib/repositories/drafts';
import { getUserCounts } from '@/lib/repositories/users';
import type { ApiError, ApiResponse } from '@/types';

/**
 * Defines the admin dashboard aggregate statistics payload.
 */
export interface AdminStats {
  totalUsers: number;
  activeDrafts: number;
}

/**
 * Handles GET requests for this route.
 * @param request - The incoming request object.
 * @returns A response describing the request result.
 */
export async function GET(request: NextRequest) {
  const adminCheck = await requireAdmin(request, '[GET /api/admin/stats]');
  if (adminCheck.ok === false) return adminCheck.response;

  try {
    const [userCounts, activeDrafts] = await Promise.all([getUserCounts(), countActiveDrafts()]);

    const stats: AdminStats = {
      totalUsers: userCounts.totalUsers,
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
