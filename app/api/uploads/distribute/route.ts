import { NextRequest, NextResponse, after } from 'next/server';
import type { ConnectedAccountPlatform, Draft, PlatformUpload } from '@/types';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { buildMetadataForPlatform } from '@/lib/draft-upload-metadata';
import type { PlatformUploadMetadata } from '@/lib/platforms/types';
import { deleteObject, getObjectWebStream, isTempUploadObjectKeyForUser } from '@/lib/r2';
import { getDraftById } from '@/lib/repositories/drafts';
import { getUserById } from '@/lib/repositories/users';
import { getConnectedAccountWithTokens } from '@/lib/repositories/connected-accounts';
import { updateTokens } from '@/lib/repositories/connected-accounts';
import { listUploadJobsByUser, updateUploadJobStatus } from '@/lib/repositories/upload-jobs';
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
const SUPPORTED_PLATFORMS: ConnectedAccountPlatform[] = ['youtube', 'vimeo'];
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

  const normalizedPlatforms = payload.platforms.filter(
    (platform): platform is ConnectedAccountPlatform =>
      typeof platform === 'string' &&
      SUPPORTED_PLATFORMS.includes(platform as ConnectedAccountPlatform)
  );

  if (normalizedPlatforms.length !== payload.platforms.length) {
    return {
      ok: false,
      error: `platforms contains unsupported values. Supported platforms: ${SUPPORTED_PLATFORMS.join(', ')}`,
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

async function runSinglePlatformUpload(
  userId: string,
  r2ObjectKey: string,
  platformUpload: PlatformUpload,
  metadata: PlatformUploadMetadata
): Promise<void> {
  await updatePlatformUploadStatus(platformUpload.id, 'uploading');

  try {
    const connectedAccount = await getConnectedAccountWithTokens(userId, platformUpload.platform);

    if (!connectedAccount) {
      await updatePlatformUploadStatus(
        platformUpload.id,
        'failed',
        undefined,
        undefined,
        `No connected ${platformUpload.platform} account found.`
      );
      return;
    }

    let tokens = {
      accessToken: connectedAccount.accessToken,
      refreshToken: connectedAccount.refreshToken,
      tokenExpiry: connectedAccount.tokenExpiry,
    };

    const shouldRefreshYouTubeToken =
      platformUpload.platform === 'youtube' &&
      (() => {
        const expiry = Date.parse(tokens.tokenExpiry ?? '');
        if (Number.isNaN(expiry)) return false;
        return expiry <= Date.now() + 60_000;
      })();

    if (shouldRefreshYouTubeToken) {
      const refreshed = await refreshYouTubeAccessToken({ refreshToken: tokens.refreshToken });
      if ('error' in refreshed) {
        await updatePlatformUploadStatus(
          platformUpload.id,
          'failed',
          undefined,
          undefined,
          `${refreshed.error.code}: ${refreshed.error.message}${refreshed.error.details ? ` Details: ${refreshed.error.details}` : ''}`
        );
        return;
      }

      tokens = {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        tokenExpiry: refreshed.tokenExpiry,
      };

      await updateTokens(
        connectedAccount.id,
        refreshed.accessToken,
        refreshed.refreshToken,
        refreshed.tokenExpiry
      );
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
      if (refreshed.ok) {
        tokens = {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          tokenExpiry: refreshed.tokenExpiry,
        };

        await updateTokens(
          connectedAccount.id,
          refreshed.accessToken,
          refreshed.refreshToken,
          refreshed.tokenExpiry
        );

        uploadResult = await executeUpload();
      }
    }

    if ('error' in uploadResult) {
      const statusSuffix =
        uploadResult.error.statusCode != null ? ` (HTTP ${uploadResult.error.statusCode})` : '';
      const detailsSuffix = uploadResult.error.details
        ? ` Details: ${uploadResult.error.details}`
        : '';
      await updatePlatformUploadStatus(
        platformUpload.id,
        'failed',
        undefined,
        undefined,
        `${uploadResult.error.code}: ${uploadResult.error.message}${statusSuffix}${detailsSuffix}`
      );
      return;
    }

    await updatePlatformUploadStatus(
      platformUpload.id,
      'completed',
      uploadResult.platformVideoId,
      uploadResult.platformUrl,
      null
    );
  } catch (error) {
    await updatePlatformUploadStatus(
      platformUpload.id,
      'failed',
      undefined,
      undefined,
      error instanceof Error ? error.message : 'Unexpected platform upload error'
    );
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

    const uploadJob = (await listUploadJobsByUser(userId)).find(
      (job) =>
        (job.draftId ?? '') === draftId &&
        job.r2Key === r2ObjectKey &&
        (job.status === 'uploading' || job.status === 'pending')
    );

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

    await updateUploadJobStatus(uploadJob.id, 'distributing', null);

    const platformUploads = await ensurePlatformUploadsForJobTargets(
      targetPlatforms.map((platform) =>
        distributeCreatePlatformUploadInput(uploadJob.id, draft, platform)
      )
    );

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
