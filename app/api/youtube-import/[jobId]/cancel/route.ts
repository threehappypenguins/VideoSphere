import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import {
  getYoutubeImportJobById,
  updateYoutubeImportJobStatus,
} from '@/lib/repositories/youtube-import-jobs';
import type { ApiError, YoutubeImportJobStatus } from '@/types';

const TERMINAL_YOUTUBE_IMPORT_STATUSES: readonly YoutubeImportJobStatus[] = [
  'completed',
  'failed',
  'cancelled',
];

/**
 * Cancels an in-progress YouTube import job.
 * @param req - Incoming POST request.
 * @param context - Route params containing the import job id.
 * @returns Empty success response when cancellation is recorded.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ jobId: string }> }
): Promise<NextResponse> {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    const errRes: ApiError = {
      error: 'Unauthorized',
      message: 'Not authenticated',
      statusCode: 401,
    };
    return NextResponse.json(errRes, { status: 401 });
  }

  const { jobId } = await context.params;
  const job = await getYoutubeImportJobById(jobId);

  if (!job) {
    const errRes: ApiError = {
      error: 'Not Found',
      message: 'YouTube import job not found',
      statusCode: 404,
    };
    return NextResponse.json(errRes, { status: 404 });
  }

  if (job.userId !== userId) {
    const errRes: ApiError = {
      error: 'Forbidden',
      message: 'You do not have access to this import job',
      statusCode: 403,
    };
    return NextResponse.json(errRes, { status: 403 });
  }

  if (TERMINAL_YOUTUBE_IMPORT_STATUSES.includes(job.status)) {
    const errRes: ApiError = {
      error: 'Conflict',
      message: `Import job is already in '${job.status}' state and cannot be cancelled`,
      statusCode: 409,
    };
    return NextResponse.json(errRes, { status: 409 });
  }

  await updateYoutubeImportJobStatus(jobId, { status: 'cancelled', errorMessage: null });

  return NextResponse.json({ success: true }, { status: 200 });
}
