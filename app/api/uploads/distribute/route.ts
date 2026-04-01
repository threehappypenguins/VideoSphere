import { NextRequest, NextResponse, after } from 'next/server';
import { CONNECTED_ACCOUNT_PLATFORMS, type ConnectedAccountPlatform } from '@/types';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import {
  distributeCreatePlatformUploadInput,
  runDistributionInBackground,
} from '@/lib/api/distribute';
import { buildMetadataForPlatform, isConnectedAccountPlatform } from '@/lib/draft-upload-metadata';
import type { PlatformUploadMetadata } from '@/lib/platforms/types';
import { isTempUploadObjectKeyForUser } from '@/lib/r2';
import { getDraftById } from '@/lib/repositories/drafts';
import { getUserById } from '@/lib/repositories/users';
import {
  findUploadJobForDistribution,
  updateUploadJobStatus,
} from '@/lib/repositories/upload-jobs';
import {
  ensurePlatformUploadsForJobTargets,
  getPlatformUploadsByJob,
} from '@/lib/repositories/platform-uploads';
import {
  PlatformUploadDocumentTooLargeError,
  platformUploadDocumentJsonForCreateRow,
} from '@/lib/platform-upload-document';

const FREE_TIER_DISTRIBUTION_PLATFORM_LIMIT = 2;

interface DistributeRequestBody {
  draftId: string;
  r2ObjectKey: string;
  platforms: ConnectedAccountPlatform[];
}

function uniquePlatforms(platforms: ConnectedAccountPlatform[]): ConnectedAccountPlatform[] {
  return [...new Set(platforms)];
}

function parseRequestBody(
  body: unknown
): { ok: true; value: DistributeRequestBody } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }

  const payload = body as Record<string, unknown>;

  if (typeof payload.draftId !== 'string' || payload.draftId.trim() === '') {
    return { ok: false, error: 'draftId is required and must be a non-empty string' };
  }

  if (typeof payload.r2ObjectKey !== 'string' || payload.r2ObjectKey.trim() === '') {
    return { ok: false, error: 'r2ObjectKey is required and must be a non-empty string' };
  }

  if (!Array.isArray(payload.platforms) || payload.platforms.length === 0) {
    return { ok: false, error: 'platforms is required and must be a non-empty array' };
  }

  const normalizedPlatforms = payload.platforms.filter(isConnectedAccountPlatform);

  if (normalizedPlatforms.length !== payload.platforms.length) {
    return {
      ok: false,
      error: `platforms contains unsupported values. Supported platforms: ${CONNECTED_ACCOUNT_PLATFORMS.join(', ')}`,
    };
  }

  return {
    ok: true,
    value: {
      draftId: payload.draftId.trim(),
      r2ObjectKey: payload.r2ObjectKey.trim(),
      platforms: normalizedPlatforms,
    },
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized: Please log in' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }

    const parsed = parseRequestBody(body);
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { draftId, r2ObjectKey, platforms } = parsed.value;

    const draft = await getDraftById(draftId);
    if (!draft) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    }

    if (draft.userId !== userId) {
      return NextResponse.json({ error: 'Forbidden: you do not own this draft' }, { status: 403 });
    }

    if (!isTempUploadObjectKeyForUser(r2ObjectKey, userId)) {
      return NextResponse.json(
        { error: 'Forbidden: storage key is not valid for this account' },
        { status: 403 }
      );
    }

    const user = await getUserById(userId);
    const isSupporter = user?.isSupporter ?? false;

    const targetPlatforms = uniquePlatforms(platforms);

    if (!isSupporter && targetPlatforms.length > FREE_TIER_DISTRIBUTION_PLATFORM_LIMIT) {
      return NextResponse.json(
        {
          error: `Free-tier users can distribute to at most ${FREE_TIER_DISTRIBUTION_PLATFORM_LIMIT} platforms per request`,
        },
        { status: 403 }
      );
    }

    const uploadJob = await findUploadJobForDistribution({
      userId,
      draftId,
      r2Key: r2ObjectKey,
    });

    if (!uploadJob) {
      return NextResponse.json(
        {
          error:
            'No upload job found for this draft and file. Complete the upload (presign → R2 PUT → complete) before distributing.',
        },
        { status: 400 }
      );
    }

    try {
      for (const platform of targetPlatforms) {
        platformUploadDocumentJsonForCreateRow(
          distributeCreatePlatformUploadInput(uploadJob.id, draft, platform)
        );
      }
    } catch (err) {
      if (err instanceof PlatformUploadDocumentTooLargeError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }

    if (uploadJob.status === 'distributing') {
      const existingUploads = await getPlatformUploadsByJob(uploadJob.id);
      const jobPlatforms = new Set(existingUploads.map((u) => u.platform));
      const notOnJob = targetPlatforms.filter((p) => !jobPlatforms.has(p));
      if (notOnJob.length > 0) {
        return NextResponse.json(
          {
            error: `This upload is already distributing. These platforms are not part of this job: ${notOnJob.join(', ')}. Retry with the same targets as the original request (or a subset).`,
          },
          { status: 409 }
        );
      }
      return NextResponse.json({ jobId: uploadJob.id }, { status: 202 });
    }

    // Persist platform_upload rows before marking the job distributing so a failed ensure
    // leaves the job in uploading/pending (retryable) instead of stuck distributing with no rows.
    const platformUploads = await ensurePlatformUploadsForJobTargets(
      targetPlatforms.map((platform) =>
        distributeCreatePlatformUploadInput(uploadJob.id, draft, platform)
      )
    );

    await updateUploadJobStatus(uploadJob.id, 'distributing', null);

    const metadataByPlatformId = new Map<string, PlatformUploadMetadata>();
    for (const pu of platformUploads) {
      metadataByPlatformId.set(pu.id, buildMetadataForPlatform(draft, pu.platform));
    }

    // Schedule after the response so serverless hosts (e.g. Vercel) keep the invocation
    // alive until this work finishes (Next `after` → waitUntil-style semantics). For
    // multi-minute uploads or guaranteed delivery across crashes, use a queue/worker.
    after(() =>
      runDistributionInBackground(
        uploadJob.id,
        userId,
        r2ObjectKey,
        platformUploads,
        metadataByPlatformId
      )
    );

    return NextResponse.json({ jobId: uploadJob.id }, { status: 202 });
  } catch (error) {
    console.error('[POST /api/uploads/distribute] Unexpected error:', error);
    return NextResponse.json({ error: 'Failed to start distribution' }, { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'Method not allowed. Use POST to start distribution.' },
    { status: 405, headers: { Allow: 'POST' } }
  );
}
