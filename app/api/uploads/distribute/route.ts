import { NextRequest, NextResponse, after } from 'next/server';
import {
  CONNECTED_ACCOUNT_PLATFORMS,
  type ConnectedAccountPlatform,
  type Draft,
  type PlatformUpload,
  type PlatformUploadStatus,
} from '@/types';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { buildMetadataForPlatform, isConnectedAccountPlatform } from '@/lib/draft-upload-metadata';
import type { PlatformUploadMetadata } from '@/lib/platforms/types';
import { deleteObject, getObjectWebStream, isTempUploadObjectKeyForUser } from '@/lib/r2';
import { getDraftById } from '@/lib/repositories/drafts';
import { getUserById } from '@/lib/repositories/users';
import { getConnectedAccountWithTokens, updateTokens } from '@/lib/repositories/connected-accounts';
import { refreshTokenIfNeeded, type PlatformTokens } from '@/lib/platforms/token-refresh';
import {
  findUploadJobForDistribution,
  updateUploadJobStatus,
} from '@/lib/repositories/upload-jobs';
import {
  type CreatePlatformUploadInput,
  ensurePlatformUploadsForJobTargets,
  getPlatformUploadsByJob,
  updatePlatformUploadStatus,
} from '@/lib/repositories/platform-uploads';
import {
  PlatformUploadDocumentTooLargeError,
  platformUploadDocumentJsonForCreateRow,
} from '@/lib/platform-upload-document';
import { refreshYouTubeAccessToken, uploadToYouTube } from '@/lib/platforms/youtube';
import { uploadToVimeo } from '@/lib/platforms/vimeo';

const FREE_TIER_DISTRIBUTION_PLATFORM_LIMIT = 2;

interface DistributeRequestBody {
  draftId: string;
  r2ObjectKey: string;
  platforms: ConnectedAccountPlatform[];
}

function uniquePlatforms(platforms: ConnectedAccountPlatform[]): ConnectedAccountPlatform[] {
  return [...new Set(platforms)];
}

function distributeCreatePlatformUploadInput(
  uploadJobId: string,
  draft: Draft,
  platform: ConnectedAccountPlatform
): CreatePlatformUploadInput {
  const meta = buildMetadataForPlatform(draft, platform);
  return {
    uploadJobId,
    platform,
    title: meta.title,
    description: meta.description,
    tags: meta.tags,
    visibility: meta.visibility,
    ...(platform === 'youtube'
      ? {
          ...(meta.categoryId !== undefined ? { categoryId: meta.categoryId } : {}),
          ...(meta.madeForKids !== undefined ? { madeForKids: meta.madeForKids } : {}),
          ...(draft.platforms.youtube !== undefined
            ? { draftYoutube: draft.platforms.youtube }
            : {}),
        }
      : {}),
    ...(platform === 'vimeo'
      ? {
          ...(meta.vimeoCategoryUri !== undefined
            ? { vimeoCategoryUri: meta.vimeoCategoryUri }
            : {}),
          ...(draft.platforms.vimeo !== undefined ? { draftVimeo: draft.platforms.vimeo } : {}),
        }
      : {}),
  };
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

/** Throws if Appwrite returns 404 — avoids continuing upload when the row no longer exists. */
async function requireUpdatePlatformUploadStatus(
  id: string,
  status: PlatformUploadStatus,
  platformVideoId?: string,
  platformUrl?: string,
  errorMessage?: string | null
): Promise<void> {
  const row = await updatePlatformUploadStatus(
    id,
    status,
    platformVideoId,
    platformUrl,
    errorMessage
  );
  if (row === null) {
    throw new Error(`platform_upload ${id} not found (cannot set status to ${status})`);
  }
}

async function runSinglePlatformUpload(
  userId: string,
  r2ObjectKey: string,
  platformUpload: PlatformUpload,
  metadata: PlatformUploadMetadata
): Promise<void> {
  try {
    await requireUpdatePlatformUploadStatus(platformUpload.id, 'uploading');

    const connectedAccount = await getConnectedAccountWithTokens(userId, platformUpload.platform);

    if (!connectedAccount) {
      await requireUpdatePlatformUploadStatus(
        platformUpload.id,
        'failed',
        undefined,
        undefined,
        `No connected ${platformUpload.platform} account found.`
      );
      return;
    }

    let tokens: PlatformTokens;
    try {
      tokens = await refreshTokenIfNeeded(connectedAccount);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await requireUpdatePlatformUploadStatus(
        platformUpload.id,
        'failed',
        undefined,
        undefined,
        message
      );
      return;
    }

    // Each attempt opens a new R2 GetObject stream so uploads stay parallel-safe and
    // we never buffer multi‑GB files in RAM (unlike a shared presigned fetch() body).
    const executeUpload = async () => {
      const { stream, contentLength, contentType } = await getObjectWebStream(r2ObjectKey);
      return platformUpload.platform === 'youtube'
        ? uploadToYouTube({ videoStream: stream, contentLength, contentType, metadata, tokens })
        : uploadToVimeo({ videoStream: stream, contentLength, contentType, metadata, tokens });
    };

    let uploadResult = await executeUpload();

    if (
      platformUpload.platform === 'youtube' &&
      'error' in uploadResult &&
      uploadResult.error.statusCode === 401 &&
      tokens.refreshToken
    ) {
      const refreshed = await refreshYouTubeAccessToken({ refreshToken: tokens.refreshToken });
      if ('error' in refreshed) {
        const statusSuffix =
          refreshed.error.statusCode != null ? ` (HTTP ${refreshed.error.statusCode})` : '';
        const detailsSuffix = refreshed.error.details ? ` Details: ${refreshed.error.details}` : '';
        await requireUpdatePlatformUploadStatus(
          platformUpload.id,
          'failed',
          undefined,
          undefined,
          `${refreshed.error.code}: ${refreshed.error.message}${statusSuffix}${detailsSuffix}`
        );
        return;
      }

      tokens = {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        tokenExpiry: refreshed.tokenExpiry,
      };

      const persisted = await updateTokens(
        connectedAccount.id,
        refreshed.accessToken,
        refreshed.refreshToken,
        refreshed.tokenExpiry
      );
      if (persisted === null) {
        await requireUpdatePlatformUploadStatus(
          platformUpload.id,
          'failed',
          undefined,
          undefined,
          'Failed to persist refreshed YouTube tokens because the connected account no longer exists.'
        );
        return;
      }

      uploadResult = await executeUpload();
    }

    if ('error' in uploadResult) {
      const statusSuffix =
        uploadResult.error.statusCode != null ? ` (HTTP ${uploadResult.error.statusCode})` : '';
      const detailsSuffix = uploadResult.error.details
        ? ` Details: ${uploadResult.error.details}`
        : '';
      await requireUpdatePlatformUploadStatus(
        platformUpload.id,
        'failed',
        undefined,
        undefined,
        `${uploadResult.error.code}: ${uploadResult.error.message}${statusSuffix}${detailsSuffix}`
      );
      return;
    }

    await requireUpdatePlatformUploadStatus(
      platformUpload.id,
      'completed',
      uploadResult.platformVideoId,
      uploadResult.platformUrl,
      null
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unexpected platform upload error';
    const marked = await updatePlatformUploadStatus(
      platformUpload.id,
      'failed',
      undefined,
      undefined,
      detail
    );
    if (marked === null) {
      console.error(
        `[POST /api/uploads/distribute] platform_upload ${platformUpload.id} missing; could not persist failure (${detail})`
      );
      throw error instanceof Error ? error : new Error(detail);
    }
  }
}

async function runDistributionInBackground(
  jobId: string,
  userId: string,
  r2ObjectKey: string,
  platformUploads: PlatformUpload[],
  metadataByPlatformId: Map<string, PlatformUploadMetadata>
): Promise<void> {
  const attemptPlatformUploadIds = new Set(platformUploads.map((p) => p.id));
  try {
    await Promise.all(
      platformUploads.map((platformUpload) => {
        const meta = metadataByPlatformId.get(platformUpload.id);
        if (!meta) {
          throw new Error(`Missing merged metadata for platform upload ${platformUpload.id}`);
        }
        return runSinglePlatformUpload(userId, r2ObjectKey, platformUpload, meta);
      })
    );

    const finalPlatformUploads = await getPlatformUploadsByJob(jobId);
    const attemptResults = finalPlatformUploads.filter((u) => attemptPlatformUploadIds.has(u.id));
    const foundAttemptIds = new Set(attemptResults.map((u) => u.id));
    const missingAttemptRows = [...attemptPlatformUploadIds].filter(
      (id) => !foundAttemptIds.has(id)
    );
    if (missingAttemptRows.length > 0) {
      await updateUploadJobStatus(
        jobId,
        'failed',
        `Platform upload row(s) missing after distribution: ${missingAttemptRows.join(', ')}`
      );
      return;
    }

    const failedUploads = attemptResults.filter((upload) => upload.status === 'failed');

    if (failedUploads.length > 0) {
      const errorDetails = failedUploads
        .map((u) => `${u.platform}: ${u.errorMessage || 'Unknown error'}`)
        .join('; ');
      await updateUploadJobStatus(
        jobId,
        'failed',
        `${failedUploads.length} platform upload(s) failed: ${errorDetails}`
      );
      return;
    }

    const nonCompleted = attemptResults.filter((u) => u.status !== 'completed');
    if (nonCompleted.length > 0) {
      await updateUploadJobStatus(
        jobId,
        'failed',
        `Platform upload(s) not in completed state: ${nonCompleted.map((u) => `${u.platform}=${u.status}`).join('; ')}`
      );
      return;
    }

    await deleteObject(r2ObjectKey).catch((cleanupError) => {
      console.error(
        `[POST /api/uploads/distribute] Failed to delete temporary R2 object for job ${jobId}:`,
        cleanupError
      );
    });

    await updateUploadJobStatus(jobId, 'completed', null);
  } catch (error) {
    console.error(
      `[POST /api/uploads/distribute] Background distribution failed for job ${jobId}:`,
      error
    );
    await updateUploadJobStatus(
      jobId,
      'failed',
      error instanceof Error ? error.message : 'Distribution failed unexpectedly'
    ).catch((updateError) => {
      console.error(
        `[POST /api/uploads/distribute] Failed to mark job ${jobId} as failed:`,
        updateError
      );
    });
  }
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
