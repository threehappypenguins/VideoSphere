import { NextRequest, NextResponse, after } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getUploadJobById, updateUploadJobStatus } from '@/lib/repositories/upload-jobs';
import {
  ensurePlatformUploadsForJobTargets,
  getPlatformUploadsByJob,
} from '@/lib/repositories/platform-uploads';
import { getDraftById } from '@/lib/repositories/drafts';
import { headObject, R2ObjectNotFoundError } from '@/lib/r2';
import { buildMetadataForPlatform } from '@/lib/draft-upload-metadata';
import {
  assessPlatformUploadRetryability,
  distributeCreatePlatformUploadInput,
  runDistributionInBackground,
} from '@/lib/api/distribute';
import type { ConnectedAccountPlatform } from '@/types';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized: Please log in' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const job = await getUploadJobById(id);
    if (!job || job.userId !== userId) {
      return NextResponse.json({ error: 'Upload job not found' }, { status: 404 });
    }

    if (job.status === 'distributing') {
      return NextResponse.json(
        { error: 'Upload job is currently distributing. Please wait for it to finish.' },
        { status: 409 }
      );
    }

    if (!job.r2Key) {
      return NextResponse.json(
        { error: 'This upload no longer has an associated video file. Please re-upload.' },
        { status: 404 }
      );
    }

    try {
      await headObject(job.r2Key);
    } catch (error) {
      if (error instanceof R2ObjectNotFoundError) {
        return NextResponse.json(
          { error: 'Video file expired — please re-upload' },
          { status: 404 }
        );
      }
      throw error;
    }

    if (!job.draftId) {
      return NextResponse.json(
        { error: 'This upload cannot be retried because it is not linked to a draft.' },
        { status: 400 }
      );
    }

    const draft = await getDraftById(job.draftId);
    if (!draft || draft.userId !== userId) {
      return NextResponse.json({ error: 'Draft not found for this upload job' }, { status: 404 });
    }

    const allUploads = await getPlatformUploadsByJob(job.id);
    const latestByPlatform = new Map<ConnectedAccountPlatform, (typeof allUploads)[number]>();
    for (const upload of allUploads) {
      if (!latestByPlatform.has(upload.platform)) {
        latestByPlatform.set(upload.platform, upload);
      }
    }

    const retryableFailedPlatforms = [...latestByPlatform.values()]
      .filter((upload) => upload.status === 'failed')
      .filter((upload) => assessPlatformUploadRetryability(upload.errorMessage).retryable)
      .map((upload) => upload.platform);

    if (retryableFailedPlatforms.length === 0) {
      return NextResponse.json(
        { error: 'No retryable failed platform uploads were found for this job.' },
        { status: 400 }
      );
    }

    const platformUploads = await ensurePlatformUploadsForJobTargets(
      retryableFailedPlatforms.map((platform) =>
        distributeCreatePlatformUploadInput(job.id, draft, platform)
      )
    );

    await updateUploadJobStatus(job.id, 'distributing', null);

    const metadataByPlatformId = new Map<string, ReturnType<typeof buildMetadataForPlatform>>();
    for (const pu of platformUploads) {
      metadataByPlatformId.set(pu.id, buildMetadataForPlatform(draft, pu.platform));
    }

    after(() =>
      runDistributionInBackground(
        job.id,
        userId,
        job.r2Key!,
        platformUploads,
        metadataByPlatformId,
        {
          subsetRetry: true,
        }
      )
    );

    return NextResponse.json(
      {
        jobId: job.id,
        retriedPlatforms: retryableFailedPlatforms,
      },
      { status: 202 }
    );
  } catch (error) {
    console.error('[POST /api/uploads/jobs/:id/retry] Unexpected error:', error);
    return NextResponse.json({ error: 'Failed to retry upload job' }, { status: 500 });
  }
}
