import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getUserById } from '@/lib/repositories/users';
import type { ApiError } from '@/types';

export async function GET(req: NextRequest) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    const errRes: ApiError = {
      error: 'Unauthorized',
      message: 'Not authenticated',
      statusCode: 401,
    };
    return NextResponse.json(errRes, { status: 401 });
  }

  const user = await getUserById(userId);
  const isSupporter = user?.isSupporter ?? false;
  const isAdmin = user?.role === 'admin';

  return NextResponse.json({
    // PRD/Roadmap: AI metadata is available to all authenticated users.
    canUseAiMetadata: true,
    isSupporter,
    isAdmin,
  });
}
