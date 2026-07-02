import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getYoutubeImportJobById } from '@/lib/repositories/youtube-import-jobs';
import { queueYoutubeImportDistribute } from '@/lib/youtube-import/queue-import-distribute';
import type { ApiError, ApiResponse, YoutubeImportJob } from '@/types';

/**
 * Queues platform distribution for a YouTube import job. When staging has already
 * finished, distribution starts immediately; otherwise it runs when import completes.
 * @param req - Incoming POST request.
 * @param context - Route params containing the import job id.
 * @returns Updated import job row.
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

  try {
    const job = await queueYoutubeImportDistribute(jobId, userId);
    const response: ApiResponse<YoutubeImportJob> = { data: job };
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message === 'YouTube import job not found') {
      const errRes: ApiError = {
        error: 'Not Found',
        message,
        statusCode: 404,
      };
      return NextResponse.json(errRes, { status: 404 });
    }

    if (message === 'You do not have access to this import job') {
      const errRes: ApiError = {
        error: 'Forbidden',
        message,
        statusCode: 403,
      };
      return NextResponse.json(errRes, { status: 403 });
    }

    if (
      message === 'This import job can no longer be uploaded' ||
      message === 'Import job is not ready to upload'
    ) {
      const errRes: ApiError = {
        error: 'Conflict',
        message,
        statusCode: 409,
      };
      return NextResponse.json(errRes, { status: 409 });
    }

    console.error(`[POST /api/youtube-import/${jobId}/queue-distribute]`, error);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to queue YouTube import upload',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}

/**
 * Returns the current import job row (for polling queue state).
 * @param req - Incoming GET request.
 * @param context - Route params containing the import job id.
 * @returns Import job snapshot.
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

  const response: ApiResponse<YoutubeImportJob> = { data: job };
  return NextResponse.json(response, { status: 200 });
}
