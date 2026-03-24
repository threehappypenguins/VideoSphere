import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { countActiveDrafts } from '@/lib/repositories/drafts';
import { getCurrentUsageMonth, getTotalUploadsForMonth } from '@/lib/repositories/upload-usage';
import { getUserById, getUserCounts } from '@/lib/repositories/users';

interface AdminStats {
  totalUsers: number;
  totalSupporters: number;
  uploadsThisMonth: number;
  activeDrafts: number;
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

    return NextResponse.json({ data: stats });
  } catch (error) {
    console.error('[GET /api/admin/stats]', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to load admin stats', statusCode: 500 },
      { status: 500 }
    );
  }
}
