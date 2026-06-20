import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { abortMultipartUpload, deleteObject, R2ObjectNotFoundError } from '@/lib/r2';
import { getUploadJobById, updateUploadJobStatus } from '@/lib/repositories/upload-jobs';
import type { ApiError } from '@/types';

function uploadJobNotFound(): NextResponse {
  const errRes: ApiError = {
    error: 'Not Found',
    message: 'Upload job not found',
    statusCode: 404,
  };
  return NextResponse.json(errRes, { status: 404 });
}

/**
 * Reads an optional `{ uploadId?: string }` body. Missing, empty, or invalid JSON is treated
 * as no multipart session (legacy single-PUT cleanup via deleteObject).
 * @param req - Incoming cancel request.
 * @returns Trimmed upload id when provided, otherwise undefined.
 */
async function parseOptionalUploadId(req: NextRequest): Promise<string | undefined> {
  try {
    const text = await req.text();
    if (!text.trim()) {
      return undefined;
    }

    const body: unknown = JSON.parse(text);
    if (typeof body !== 'object' || body === null) {
      return undefined;
    }

    const uploadId = (body as Record<string, unknown>).uploadId;
    if (typeof uploadId !== 'string' || uploadId.trim() === '') {
      return undefined;
    }

    return uploadId.trim();
  } catch {
    return undefined;
  }
}

/**
 * Handles POST requests for this route.
 * @param req - The incoming request object.
 * @param props - Component props.
 * @returns A response describing the request result.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
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

  const { jobId } = await params;
  const job = await getUploadJobById(jobId);
  if (!job) {
    return uploadJobNotFound();
  }
  if (job.userId !== userId) {
    // Same response as a missing job (aligns with GET /api/uploads/jobs/[id]) — avoids
    // leaking that a job id exists for another user.
    return uploadJobNotFound();
  }

  // Only allow cancellation before distribution starts.
  if (job.status !== 'pending' && job.status !== 'uploading') {
    const errRes: ApiError = {
      error: 'Conflict',
      message: `Cannot cancel upload in '${job.status}' state.`,
      statusCode: 409,
    };
    return NextResponse.json(errRes, { status: 409 });
  }

  try {
    const uploadId = await parseOptionalUploadId(req);

    // Mark cancelled before R2 cleanup so a failed delete does not leave the job
    // pending/uploading while the blob may already be gone; R2 cleanup is best-effort.
    // Keep errorMessage for actual failures; cancelled is a terminal non-error state.
    const updated = await updateUploadJobStatus(jobId, 'cancelled', null);
    if (!updated) {
      // Row deleted or raced with another writer — updateRow returned 404.
      return uploadJobNotFound();
    }

    if (job.r2Key) {
      if (uploadId) {
        await abortMultipartUpload(job.r2Key, uploadId);
      } else {
        await deleteObject(job.r2Key).catch((error) => {
          if (error instanceof R2ObjectNotFoundError) return;
          console.error(
            `[POST /api/uploads/:jobId/cancel] Failed to delete R2 object for cancelled job ${jobId}:`,
            error
          );
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/uploads/:jobId/cancel]', error);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to cancel upload',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
