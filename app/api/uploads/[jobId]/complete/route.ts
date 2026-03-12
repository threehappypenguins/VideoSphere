/**
 * POST /api/uploads/[jobId]/complete
 *
 * Called by the client after a successful browser-to-R2 PUT.
 * Verifies the actual stored object size and transitions the UploadJob status
 * from pending → uploading (ready for distribution).
 *
 * Quota is enforced at presign time (POST /api/uploads/presign), not here.
 * This endpoint is responsible only for confirming delivery and advancing job state.
 *
 * Path parameter:
 *   jobId  - ID of the UploadJob created during the presign step
 *
 * Response (200 OK):
 * {
 *   success: true
 * }
 *
 * Error responses:
 * - 400 Bad Request: UploadJob has no R2 key, or the stored object exceeds 5 GB
 *                  (oversized objects are deleted from R2; UploadJob is marked failed)
 * - 401 Unauthorized: Not authenticated
 * - 403 Forbidden (ownership): UploadJob belongs to a different user
 * - 404 Not Found: UploadJob does not exist
 * - 409 Conflict: UploadJob is not in the expected `pending` state
 *                 (prevents re-finalizing completed, distributing, or failed jobs)
 * - 500 Internal Server Error
 *
 * Security:
 * - Only the authenticated user who created the UploadJob may call this endpoint
 * - Ownership is verified before touching R2 — prevents IDOR abuse
 * - Actual object byte size is verified via HEAD request before status is advanced;
 *   oversized objects are deleted from R2 (server-side enforcement layer 2)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { headObject, deleteObject, R2ObjectNotFoundError } from '@/lib/r2';
import { getUploadJobById, updateUploadJobStatus } from '@/lib/repositories/upload-jobs';

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB in bytes

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
): Promise<NextResponse> {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized: Please log in to complete uploads' },
        { status: 401 }
      );
    }

    const { jobId } = await params;

    const job = await getUploadJobById(jobId);
    if (!job) {
      return NextResponse.json({ error: 'Upload job not found' }, { status: 404 });
    }
    if (job.userId !== userId) {
      return NextResponse.json(
        { error: 'Forbidden: you do not own this upload job' },
        { status: 403 }
      );
    }

    // Enforce the intended state transition: only a pending job may be finalized.
    // Rejecting any other status prevents re-finalizing completed, distributing,
    // or failed jobs via a second call to this endpoint.
    if (job.status !== 'pending') {
      return NextResponse.json(
        {
          error: `Upload job is already in '${job.status}' state and cannot be finalized again`,
        },
        { status: 409 }
      );
    }

    // Server-side size enforcement (layer 2): HEAD the actual R2 object and verify
    // it does not exceed the 5 GB cap. This catches any gap between the declared
    // fileSize (used to sign the Content-Length header at presign time) and the
    // bytes actually stored. Oversized objects are deleted from R2 before the job
    // is marked failed, preventing orphaned unusable objects from accumulating.
    if (!job.r2Key) {
      return NextResponse.json(
        { error: 'Upload job has no associated R2 object key' },
        { status: 400 }
      );
    }
    let actualBytes: number;
    try {
      actualBytes = await headObject(job.r2Key);
    } catch (err) {
      if (err instanceof R2ObjectNotFoundError) {
        // The object is absent — the upload never reached R2 (e.g. cancelled
        // mid-flight or PUT failed). Mark the job failed so it doesn't linger
        // as pending, then tell the client to treat this as a flow error.
        await updateUploadJobStatus(
          jobId,
          'failed',
          'Object not found in R2; upload may not have completed'
        ).catch(() => {});
        return NextResponse.json(
          {
            error: 'Upload not found in storage. The file may not have been uploaded successfully.',
          },
          { status: 404 }
        );
      }
      throw err; // unexpected R2 error — fall through to outer catch → 500
    }
    if (actualBytes > MAX_FILE_SIZE) {
      await Promise.allSettled([
        deleteObject(job.r2Key),
        updateUploadJobStatus(jobId, 'failed', 'Uploaded file exceeds the 5 GB maximum size limit'),
      ]);
      return NextResponse.json(
        { error: 'Uploaded file exceeds the 5 GB maximum size limit; the object has been deleted' },
        { status: 400 }
      );
    }

    // Advance job: pending → uploading (R2 upload confirmed; awaiting distribution)
    await updateUploadJobStatus(jobId, 'uploading');

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Upload complete error:', error);
    return NextResponse.json(
      { error: 'Failed to record upload completion. Please try again.' },
      { status: 500 }
    );
  }
}
