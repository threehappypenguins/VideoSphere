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
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Only allow cancellation before distribution starts.
  if (job.status !== 'pending' && job.status !== 'uploading') {
    return NextResponse.json(
      { error: `Cannot cancel upload in '${job.status}' state` },
      { status: 409 }
    );
  }

  try {
    if (job.r2Key) {
      await deleteObject(job.r2Key).catch((error) => {
        if (error instanceof R2ObjectNotFoundError) return;
        throw error;
      });
    }

    await updateUploadJobStatus(jobId, 'cancelled', 'Upload cancelled by user');

    // Presign claims a monthly upload slot for limited users. If the user
    // cancels before distribution starts, best-effort release that slot.
    const user = await getUserById(userId);
    const hasUnlimitedUploads = Boolean(user?.isSupporter) || user?.role === 'admin';
    if (!hasUnlimitedUploads) {
      const quotaMonth = usageMonthFromUtcIso(job.$createdAt);
      await decrementUsage(userId, quotaMonth).catch((rollbackErr) => {
        console.error(
          `Failed to roll back quota slot for cancelled upload ${jobId} (user ${userId}):`,
          rollbackErr
        );
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/uploads/:jobId/cancel]', error);
    return NextResponse.json({ error: 'Failed to cancel upload' }, { status: 500 });
  }
}
