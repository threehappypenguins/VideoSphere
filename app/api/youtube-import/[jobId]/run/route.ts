import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { executeYoutubeImportJobWorker } from '@/lib/youtube-import/execute-import-job';
import { getYoutubeImportJobById } from '@/lib/repositories/youtube-import-jobs';
import type { ApiError } from '@/types';

/** Allow long downloads/trims in hosted environments that honor route segment config. */
export const maxDuration = 3600;

/**
 * Executes a pending YouTube import job for the authenticated owner. Prefer
 * server-side scheduling from `/start`; this route remains for manual resume.
 * @param req - Incoming POST request.
 * @param context - Route params containing the import job id.
 * @returns Terminal job row when the worker ran; 409 when already active.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ jobId: string }> }
): Promise<NextResponse> {
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

  const userId = await getAuthenticatedUserId(req);
  if (userId == null || job.userId !== userId) {
    const errRes: ApiError = {
      error: 'Forbidden',
      message: 'You do not have access to run this import job',
      statusCode: 403,
    };
    return NextResponse.json(errRes, { status: 403 });
  }

  try {
    const result = await executeYoutubeImportJobWorker(jobId, userId);

    if (result.outcome === 'not_found') {
      const errRes: ApiError = {
        error: 'Not Found',
        message: 'YouTube import job not found',
        statusCode: 404,
      };
      return NextResponse.json(errRes, { status: 404 });
    }

    if (result.outcome === 'already_running') {
      return NextResponse.json({ accepted: false, status: result.status }, { status: 409 });
    }

    const finished = await getYoutubeImportJobById(jobId);
    return NextResponse.json({ data: finished }, { status: 200 });
  } catch (error) {
    console.error(`[POST /api/youtube-import/${jobId}/run] Import worker failed:`, error);
    const message = error instanceof Error ? error.message : String(error);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message,
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
