import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { YOUTUBE_IMPORT_WORKER_HEADER } from '@/lib/youtube-import/kickoff-import-job';
import { runYoutubeImportJob } from '@/lib/youtube-import/run-import-job';
import {
  claimPendingYoutubeImportJob,
  getYoutubeImportJobById,
} from '@/lib/repositories/youtube-import-jobs';
import type { ApiError } from '@/types';

/** Allow long downloads/trims in hosted environments that honor route segment config. */
export const maxDuration = 3600;

function isAuthorizedWorkerRequest(req: NextRequest): boolean {
  const expected = process.env.YOUTUBE_IMPORT_WORKER_SECRET?.trim();
  if (!expected) {
    return false;
  }
  return req.headers.get(YOUTUBE_IMPORT_WORKER_HEADER) === expected;
}

/**
 * Executes a pending YouTube import job. The request stays open until the
 * download/trim/upload pipeline finishes so dev and container hosts keep the
 * worker alive for the full yt-dlp/ffmpeg run.
 * @param req - Incoming POST request.
 * @param context - Route params containing the import job id.
 * @returns Accepted when the job is already running or finished; otherwise the terminal job row.
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
  const authorizedByUser = userId != null && job.userId === userId;
  const authorizedByWorker = isAuthorizedWorkerRequest(req);

  if (!authorizedByUser && !authorizedByWorker) {
    const errRes: ApiError = {
      error: 'Forbidden',
      message: 'You do not have access to run this import job',
      statusCode: 403,
    };
    return NextResponse.json(errRes, { status: 403 });
  }

  const claimed = authorizedByWorker
    ? await claimPendingYoutubeImportJob(jobId)
    : await claimPendingYoutubeImportJob(jobId, userId!);

  if (!claimed) {
    const current = await getYoutubeImportJobById(jobId);
    if (!current) {
      const errRes: ApiError = {
        error: 'Not Found',
        message: 'YouTube import job not found',
        statusCode: 404,
      };
      return NextResponse.json(errRes, { status: 404 });
    }
    return NextResponse.json({ accepted: false, status: current.status }, { status: 409 });
  }

  console.info(`[POST /api/youtube-import/${jobId}/run] Starting import worker`);

  try {
    await runYoutubeImportJob(jobId);
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

  const finished = await getYoutubeImportJobById(jobId);
  return NextResponse.json({ data: finished }, { status: 200 });
}
