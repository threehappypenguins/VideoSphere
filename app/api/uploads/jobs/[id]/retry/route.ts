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
  distributeCreatePlatformUploadInput,
  runDistributionInBackground,
} from '@/lib/api/distribute';
import { assessPlatformUploadRetryability } from '@/lib/utils/retryability';
import { latestPlatformUploadsPerPlatform } from '@/lib/utils/platform-uploads';
import type { ConnectedAccountPlatform } from '@/types';
import { CONNECTED_ACCOUNT_PLATFORMS } from '@/types';

const CONNECTED_PLATFORM_SET = new Set<string>(CONNECTED_ACCOUNT_PLATFORMS);

/**
 * Parses an optional `{ platforms }` body for single- or multi-platform retry.
 * @param request - Incoming POST request.
 * @returns `null` when the body is empty (retry all retryable failed platforms); otherwise the validated platform list, or an error message.
 */
async function parseRetryPlatformsBody(
  request: NextRequest
): Promise<
  { ok: true; platforms: ConnectedAccountPlatform[] | null } | { ok: false; error: string }
> {
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.trim() === '') {
      return { ok: true, platforms: null };
    }
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Invalid JSON body.' };
  }

  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }

  const platformsRaw = (raw as { platforms?: unknown }).platforms;
  if (platformsRaw === undefined) {
    return { ok: true, platforms: null };
  }

  if (!Array.isArray(platformsRaw) || platformsRaw.length === 0) {
    return { ok: false, error: 'platforms must be a non-empty array of platform identifiers.' };
  }

  const platforms: ConnectedAccountPlatform[] = [];
  for (const value of platformsRaw) {
    if (typeof value !== 'string' || !CONNECTED_PLATFORM_SET.has(value)) {
      return { ok: false, error: `Invalid platform identifier: ${String(value)}` };
    }
    const platform = value as ConnectedAccountPlatform;
    if (!platforms.includes(platform)) {
      platforms.push(platform);
    }
  }

  return { ok: true, platforms };
}

/**
 * Handles POST requests for this route.
 * @param request - The incoming request object.
 * @param props - Component props.
 * @returns A response describing the request result.
 */
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

    if (job.status !== 'failed') {
      return NextResponse.json(
        {
          error:
            'Retries are only allowed for failed upload jobs. This job is not in a failed state.',
        },
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

    const parsedBody = await parseRetryPlatformsBody(request);
    if (parsedBody.ok === false) {
      return NextResponse.json({ error: parsedBody.error }, { status: 400 });
    }

    const allUploads = await getPlatformUploadsByJob(job.id);
    const latestByPlatform = latestPlatformUploadsPerPlatform(allUploads);

    const retryableFailedPlatforms = latestByPlatform
      .filter((upload) => upload.status === 'failed')
      .filter((upload) => assessPlatformUploadRetryability(upload.errorMessage).retryable)
      .map((upload) => upload.platform);

    const platformsToRetry =
      parsedBody.platforms == null
        ? retryableFailedPlatforms
        : parsedBody.platforms.filter((platform) => retryableFailedPlatforms.includes(platform));

    if (platformsToRetry.length === 0) {
      return NextResponse.json(
        { error: 'No retryable failed platform uploads were found for this job.' },
        { status: 400 }
      );
    }

    const platformUploads = await ensurePlatformUploadsForJobTargets(
      platformsToRetry.map((platform) =>
        distributeCreatePlatformUploadInput(job.id, draft, platform)
      )
    );

    const updatedJob = await updateUploadJobStatus(job.id, 'distributing', null);
    if (updatedJob === null) {
      return NextResponse.json({ error: 'Upload job not found' }, { status: 404 });
    }

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
        retriedPlatforms: platformsToRetry,
      },
      { status: 202 }
    );
  } catch (error) {
    console.error('[POST /api/uploads/jobs/:id/retry] Unexpected error:', error);
    return NextResponse.json({ error: 'Failed to retry upload job' }, { status: 500 });
  }
}
