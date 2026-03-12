/**
 * POST /api/uploads/[jobId]/complete
 *
 * Called by the client after a successful browser-to-R2 PUT.
 * Atomically enforces the monthly quota and transitions the UploadJob status
 * from pending → uploading (ready for distribution).
 *
 * Quota enforcement uses an increment-first strategy: the counter is
 * atomically incremented, then the resulting value is checked against the
 * limit. If the slot is over the cap it is immediately rolled back with an
 * atomic decrement, ensuring the persisted count never permanently exceeds
 * the free-tier limit even under concurrent load.
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
 *                  (oversized objects are automatically deleted from R2)
 * - 401 Unauthorized: Not authenticated
 * - 403 Forbidden (ownership): UploadJob belongs to a different user
 * - 403 Forbidden (quota): Free-tier monthly limit reached
 *                  Body: { error, message, monthlyUsage, limit }
 * - 404 Not Found: UploadJob does not exist
 * - 500 Internal Server Error
 *
 * Security:
 * - Only the authenticated user who created the UploadJob may call this endpoint
 * - Ownership is verified before touching the quota counter — prevents IDOR abuse
 * - Actual object byte size is verified via HEAD request before quota is claimed;
 *   oversized objects are deleted from R2 (server-side enforcement layer 2)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { headObject, deleteObject } from '@/lib/r2';
import { incrementUsageIfAllowed } from '@/lib/repositories/upload-usage';
import { getUserById } from '@/lib/repositories/users';
import { getUploadJobById, updateUploadJobStatus } from '@/lib/repositories/upload-jobs';

const FREE_TIER_LIMIT = 10;
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

    // Server-side size enforcement (layer 2): HEAD the actual R2 object and verify
    // it does not exceed the 5 GB cap. This catches any gap between the declared
    // fileSize (used to sign the Content-Length header at presign time) and the
    // bytes actually stored. Oversized objects are deleted before the quota slot
    // is claimed, so the user's counter is never incremented for invalid uploads.
    if (!job.r2Key) {
      return NextResponse.json(
        { error: 'Upload job has no associated R2 object key' },
        { status: 400 }
      );
    }
    const actualBytes = await headObject(job.r2Key);
    if (actualBytes > MAX_FILE_SIZE) {
      await deleteObject(job.r2Key);
      return NextResponse.json(
        { error: 'Uploaded file exceeds the 5 GB maximum size limit; the object has been deleted' },
        { status: 400 }
      );
    }

    // Atomically check quota and claim a slot using increment-first strategy.
    // This is the authoritative enforcement point — prevents concurrent complete
    // calls from pushing the counter past the free-tier cap.
    const user = await getUserById(userId);
    const isSupporter = user?.isSupporter ?? false;
    const { allowed, monthlyUsage } = await incrementUsageIfAllowed(userId, isSupporter);

    if (!allowed) {
      return NextResponse.json(
        {
          error: 'Upload limit reached',
          message: `Free-tier users are limited to ${FREE_TIER_LIMIT} uploads per month. Upgrade to Supporter for unlimited uploads.`,
          monthlyUsage,
          limit: FREE_TIER_LIMIT,
        },
        { status: 403 }
      );
    }

    // Transition: pending → uploading (R2 upload confirmed; awaiting distribution)
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
