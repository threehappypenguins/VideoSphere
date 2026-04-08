/**
 * POST /api/uploads/[jobId]/complete
 *
 * Called by the client after a successful browser-to-R2 PUT.
 * Verifies the actual stored object size, transitions the UploadJob status,
 * and automatically starts distribution to the draft's target platforms.
 * The R2 object is deleted once all platform uploads finish.
 *
 * Quota is enforced at presign time (POST /api/uploads/presign), not here.
 *
 * Path parameter:
 *   jobId  - ID of the UploadJob created during the presign step
 *
 * Response (200 OK):
 * {
 *   success: true,
 *   distributing: boolean
 * }
 * Where `distributing` is true if the upload is being automatically distributed to target
 * platforms, or false if the job is only marked as uploading (e.g., no draft or no targets).
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

import { NextRequest, NextResponse, after } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { headObject, deleteObject, R2ObjectNotFoundError } from '@/lib/r2';
import { getUploadJobById, updateUploadJobStatus } from '@/lib/repositories/upload-jobs';
import { getDraftById } from '@/lib/repositories/drafts';
import { buildMetadataForPlatform } from '@/lib/draft-upload-metadata';
import { ensurePlatformUploadsForJobTargets } from '@/lib/repositories/platform-uploads';
import {
  distributeCreatePlatformUploadInput,
  runDistributionInBackground,
} from '@/lib/api/distribute';
import type { ConnectedAccountPlatform } from '@/types';

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB in bytes

/**
 * Handles POST requests for this route.
 * @param request - The incoming request object.
 * @param props - Component props.
 * @returns A response describing the request result.
 */
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
        ).catch((dbErr) => {
          // Log but don't surface: the client still gets 404 regardless.
          // Without logging this, a persistent DB failure would leave the job
          // stuck in pending with no operational signal.
          console.error(`Failed to mark upload job ${jobId} as failed after R2 not-found:`, dbErr);
        });
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

    // --- Auto-distribute to the draft's target platforms ---
    if (!job.draftId) {
      // No draft linked — just mark as uploading (manual distribute later).
      await updateUploadJobStatus(jobId, 'uploading');
      return NextResponse.json({ success: true, distributing: false }, { status: 200 });
    }

    const draft = await getDraftById(job.draftId);
    if (!draft || draft.targets.length === 0) {
      // Draft missing or has no targets — advance to uploading only.
      await updateUploadJobStatus(jobId, 'uploading');
      return NextResponse.json({ success: true, distributing: false }, { status: 200 });
    }

    const targetPlatforms = [...new Set(draft.targets)] as ConnectedAccountPlatform[];

    // Create platform_upload rows before advancing to distributing so a failure
    // here leaves the job in pending (retryable), not stuck in distributing.
    const platformUploads = await ensurePlatformUploadsForJobTargets(
      targetPlatforms.map((platform) => distributeCreatePlatformUploadInput(jobId, draft, platform))
    );

    const updated = await updateUploadJobStatus(jobId, 'distributing', null);
    if (!updated) {
      return NextResponse.json(
        { error: 'Upload job no longer exists and could not be finalized' },
        { status: 404 }
      );
    }

    const metadataByPlatformId = new Map<string, ReturnType<typeof buildMetadataForPlatform>>();
    for (const pu of platformUploads) {
      metadataByPlatformId.set(pu.id, buildMetadataForPlatform(draft, pu.platform));
    }

    // Schedule background distribution (runs after the response is sent).
    after(() =>
      runDistributionInBackground(jobId, userId, job.r2Key!, platformUploads, metadataByPlatformId)
    );

    return NextResponse.json({ success: true, distributing: true }, { status: 200 });
  } catch (error) {
    console.error('Upload complete error:', error);
    return NextResponse.json(
      { error: 'Failed to record upload completion. Please try again.' },
      { status: 500 }
    );
  }
}
