import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { deleteObject, R2ObjectNotFoundError } from '@/lib/r2';
import { getUploadJobById, updateUploadJobStatus } from '@/lib/repositories/upload-jobs';
import { getUserById } from '@/lib/repositories/users';
import { decrementUsage, usageMonthFromUtcIso } from '@/lib/repositories/upload-usage';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
): Promise<NextResponse> {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { jobId } = await params;
  const job = await getUploadJobById(jobId);
  if (!job) {
    return NextResponse.json({ error: 'Upload job not found' }, { status: 404 });
  }
  if (job.userId !== userId) {
    // Same response as a missing job (aligns with GET /api/uploads/jobs/[id]) — avoids
    // leaking that a job id exists for another user.
    return NextResponse.json({ error: 'Upload job not found' }, { status: 404 });
  }

  // Only allow cancellation before distribution starts.
  if (job.status !== 'pending' && job.status !== 'uploading') {
    return NextResponse.json(
      { error: `Cannot cancel upload in '${job.status}' state` },
      { status: 409 }
    );
  }

  try {
    const q = job.quotaClaimMonth;
    // Legacy rows (null): tier at cancel time was used historically — still resolve user
    // before mutating so a failed lookup returns 500 without leaving the job cancelled.
    const legacyUser = q == null ? await getUserById(userId) : null;

    // Mark cancelled before R2 cleanup so a failed delete does not leave the job
    // pending/uploading while the blob may already be gone; R2 and quota are best-effort.
    const updated = await updateUploadJobStatus(jobId, 'cancelled', 'Upload cancelled by user');
    if (!updated) {
      // Row deleted or raced with another writer — updateRow returned 404.
      return NextResponse.json({ error: 'Upload job not found' }, { status: 404 });
    }

    if (job.r2Key) {
      await deleteObject(job.r2Key).catch((error) => {
        if (error instanceof R2ObjectNotFoundError) return;
        console.error(
          `[POST /api/uploads/:jobId/cancel] Failed to delete R2 object for cancelled job ${jobId}:`,
          error
        );
      });
    }

    // Roll back the same month that was claimed at presign (stored on the job), not the
    // user's current tier — avoids quota drift when supporter/admin status changes.
    const trimmedClaim = q != null && q !== '' ? q.trim() : '';
    if (trimmedClaim !== '') {
      await decrementUsage(userId, trimmedClaim).catch((rollbackErr) => {
        console.error(
          `Failed to roll back quota slot for cancelled upload ${jobId} (user ${userId}):`,
          rollbackErr
        );
      });
    } else if (q == null) {
      // Legacy jobs: no presign snapshot — fall back to previous behavior.
      const hasUnlimitedUploads = Boolean(legacyUser?.isSupporter) || legacyUser?.role === 'admin';
      if (!hasUnlimitedUploads) {
        const quotaMonth = usageMonthFromUtcIso(job.$createdAt);
        await decrementUsage(userId, quotaMonth).catch((rollbackErr) => {
          console.error(
            `Failed to roll back quota slot for cancelled upload ${jobId} (user ${userId}):`,
            rollbackErr
          );
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/uploads/:jobId/cancel]', error);
    return NextResponse.json({ error: 'Failed to cancel upload' }, { status: 500 });
  }
}
