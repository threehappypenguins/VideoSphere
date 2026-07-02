import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getActiveYoutubeImportJobForUser } from '@/lib/repositories/youtube-import-jobs';
import { scheduleYoutubeImportJob } from '@/lib/youtube-import/schedule-import-job';
import type { ApiError } from '@/types';

/**
 * Returns the authenticated user's active YouTube import job, if any.
 * @param req - Incoming GET request.
 * @returns Active import job or `{ job: null }`.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    const errRes: ApiError = {
      error: 'Unauthorized',
      message: 'Not authenticated',
      statusCode: 401,
    };
    return NextResponse.json(errRes, { status: 401 });
  }

  const job = await getActiveYoutubeImportJobForUser(userId);

  if (job?.status === 'pending') {
    scheduleYoutubeImportJob(job.id, userId);
  }

  return NextResponse.json({ job }, { status: 200 });
}
