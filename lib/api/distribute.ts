/**
 * Shared distribution logic — used by both the /api/uploads/[jobId]/complete
 * (auto-distribution) and /api/uploads/distribute (manual/retry) routes.
 *
 * Streams the video from R2 to each target platform in parallel, updates
 * platform upload statuses, and deletes the R2 object when all uploads succeed.
 */

import type {
  ConnectedAccountPlatform,
  Draft,
  PlatformUpload,
  PlatformUploadStatus,
} from '@/types';
import { buildMetadataForPlatform } from '@/lib/draft-upload-metadata';
import type { PlatformUploadMetadata } from '@/lib/platforms/types';
import { deleteObject, getObjectWebStream } from '@/lib/r2';
import { getConnectedAccountWithTokens, updateTokens } from '@/lib/repositories/connected-accounts';
import { refreshTokenIfNeeded, type PlatformTokens } from '@/lib/platforms/token-refresh';
import { updateUploadJobStatus } from '@/lib/repositories/upload-jobs';
import {
  type CreatePlatformUploadInput,
  getPlatformUploadsByJob,
  updatePlatformUploadStatus,
} from '@/lib/repositories/platform-uploads';
import { refreshYouTubeAccessToken, uploadToYouTube } from '@/lib/platforms/youtube';
import { uploadToVimeo } from '@/lib/platforms/vimeo';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the input needed to create a platform_upload row from a draft + platform. */
export function distributeCreatePlatformUploadInput(
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

// ---------------------------------------------------------------------------
// Single-platform upload
// ---------------------------------------------------------------------------

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
        `[distribute] platform_upload ${platformUpload.id} missing; could not persist failure (${detail})`
      );
      throw error instanceof Error ? error : new Error(detail);
    }
  }
}

// ---------------------------------------------------------------------------
// Background orchestrator
// ---------------------------------------------------------------------------

/**
 * Run distribution for all platform uploads in parallel, then clean up R2.
 * Called via Next.js `after()` so the HTTP response returns immediately.
 */
export async function runDistributionInBackground(
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

    // All platform uploads succeeded — clean up the temporary R2 object.
    await deleteObject(r2ObjectKey).catch((cleanupError) => {
      console.error(
        `[distribute] Failed to delete temporary R2 object for job ${jobId}:`,
        cleanupError
      );
    });

    await updateUploadJobStatus(jobId, 'completed', null);
  } catch (error) {
    console.error(`[distribute] Background distribution failed for job ${jobId}:`, error);
    await updateUploadJobStatus(
      jobId,
      'failed',
      error instanceof Error ? error.message : 'Distribution failed unexpectedly'
    ).catch((updateError) => {
      console.error(`[distribute] Failed to mark job ${jobId} as failed:`, updateError);
    });
  }
}
