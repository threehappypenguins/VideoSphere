import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getYoutubeImportJobById } from '@/lib/repositories/youtube-import-jobs';
import type { ApiError, ApiResponse, YoutubeImportJob } from '@/types';

/**
 * Returns the current status of a YouTube import job for UI polling.
 * @param req - Incoming GET request.
 * @param context - Route params containing the import job id.
 * @returns Import job status and progress fields.
 */
export async function GET(
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

  const res: ApiResponse<YoutubeImportJob> = { data: job };
  return NextResponse.json(res, { status: 200 });
}
