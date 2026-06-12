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
import { deleteObject, getObjectWebStream, isDraftThumbnailFinalKeyForUser } from '@/lib/r2';
import { getDraftById, updateDraft } from '@/lib/repositories/drafts';
import { messageFromThrown } from '@/lib/utils/error-message';
import { getConnectedAccountWithTokens, updateTokens } from '@/lib/repositories/connected-accounts';
import { refreshTokenIfNeeded, type PlatformTokens } from '@/lib/platforms/token-refresh';
import { getUploadJobById, updateUploadJobStatus } from '@/lib/repositories/upload-jobs';
import {
  type CreatePlatformUploadInput,
  getPlatformUploadsByJob,
  updatePlatformUploadStatus,
} from '@/lib/repositories/platform-uploads';
import { refreshYouTubeAccessToken, uploadToYouTube } from '@/lib/platforms/youtube';
import { uploadToVimeo } from '@/lib/platforms/vimeo';
import { uploadToGoogleDrive } from '@/lib/platforms/google-drive';
import { uploadToSftp } from '@/lib/platforms/sftp';
import { uploadToSmb } from '@/lib/platforms/smb';
import { uploadToFacebook } from '@/lib/platforms/facebook';
import {
  pollSermonAudioProcessing,
  publishSermonAudio,
  uploadToSermonAudio,
} from '@/lib/platforms/sermon-audio';
import { sermonAudioCrossPublishHasActiveSelection } from '@/lib/platforms/sermon-audio-cross-publish';
import { latestPlatformUploadsPerPlatform } from '@/lib/utils/platform-uploads';
import { isPlatformUploadDistributionComplete } from '@/lib/uploads/status';

export type { RetryabilityAssessment } from '@/lib/utils/retryability';
export { assessPlatformUploadRetryability } from '@/lib/utils/retryability';

const PLATFORM_UPLOAD_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * Aborts `signal` when the deadline elapses so R2 reads and platform `fetch` bodies stop.
 * (Plain `Promise.race` would reject without cancelling the underlying upload.)
 */
async function runUploadWithDeadline<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  const controller = new AbortController();
  const timeoutError = new Error(`${label} timed out after ${Math.floor(timeoutMs / 1000)}s`);
  const timeoutId = setTimeout(() => {
    controller.abort(timeoutError);
  }, timeoutMs);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
}

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
    ...(platform === 'sermon_audio'
      ? { sermonAudioAutoPublishOnProcessed: meta.autoPublishOnProcessed === true }
      : {}),
  };
}

/** Throws if persistence returns 404 — avoids continuing upload when the row no longer exists. */
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
  metadata: PlatformUploadMetadata,
  saApiKeyByPlatformUploadId: Map<string, string>
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

    if (platformUpload.platform === 'sermon_audio') {
      saApiKeyByPlatformUploadId.set(platformUpload.id, tokens.accessToken);
    }

    // Each attempt opens a new R2 GetObject stream so uploads stay parallel-safe and
    // we never buffer multi‑GB files in RAM (unlike a shared presigned fetch() body).
    const executeUpload = async (signal: AbortSignal) => {
      const { stream, contentLength, contentType } = await getObjectWebStream(r2ObjectKey, {
        signal,
      });
      if (platformUpload.platform === 'youtube') {
        return uploadToYouTube({
          videoStream: stream,
          contentLength,
          contentType,
          metadata,
          tokens,
          signal,
        });
      }

      if (platformUpload.platform === 'vimeo') {
        return uploadToVimeo({
          videoStream: stream,
          contentLength,
          contentType,
          metadata,
          tokens,
          signal,
        });
      }

      if (platformUpload.platform === 'google_drive') {
        return uploadToGoogleDrive({
          connectedAccount,
          videoStream: stream,
          contentLength,
          contentType,
          metadata: { title: metadata.title },
          tokens,
          signal,
        });
      }

      if (platformUpload.platform === 'sftp') {
        return uploadToSftp({
          connectedAccount,
          videoStream: stream,
          contentLength,
          contentType,
          metadata: { title: metadata.title },
          signal,
        });
      }

      if (platformUpload.platform === 'smb') {
        return uploadToSmb({
          connectedAccount,
          videoStream: stream,
          contentLength,
          contentType,
          metadata: { title: metadata.title },
          signal,
        });
      }

      if (platformUpload.platform === 'sermon_audio') {
        return uploadToSermonAudio({
          videoStream: stream,
          contentLength,
          contentType,
          metadata,
          tokens: { accessToken: tokens.accessToken },
          signal,
        });
      }

      if (platformUpload.platform === 'facebook') {
        return uploadToFacebook({
          connectedAccount,
          videoStream: stream,
          contentLength,
          contentType,
          metadata,
          tokens,
          signal,
        });
      }

      // Exhaustive platform check — throw on unsupported platforms
      const exhaustiveCheck: never = platformUpload.platform;
      throw new Error(`Unsupported platform: ${exhaustiveCheck}`);
    };

    let uploadResult = await runUploadWithDeadline(
      executeUpload,
      PLATFORM_UPLOAD_TIMEOUT_MS,
      `${platformUpload.platform} upload`
    );

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

      uploadResult = await runUploadWithDeadline(
        executeUpload,
        PLATFORM_UPLOAD_TIMEOUT_MS,
        `${platformUpload.platform} upload`
      );
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

    const terminalStatus: PlatformUploadStatus =
      platformUpload.platform === 'sermon_audio' ? 'unpublished' : 'completed';

    await requireUpdatePlatformUploadStatus(
      platformUpload.id,
      terminalStatus,
      uploadResult.platformVideoId,
      uploadResult.platformUrl,
      null
    );
  } catch (error) {
    const detail = messageFromThrown(error);
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
 * Defines the shape of run distribution in background options.
 */
export interface RunDistributionInBackgroundOptions {
  /**
   * Set for **subset** retries (e.g. POST .../jobs/[id]/retry): only `platformUploads` are
   * re-run, but job completion and R2 deletion must reflect **all** platforms on the job
   * (latest row per platform). Otherwise a successful partial retry could mark the job
   * completed and delete R2 while another platform is still failed.
   */
  subsetRetry?: boolean;
}

/**
 * Run distribution for all platform uploads in parallel, then clean up R2.
 * Called via Next.js `after()` so the HTTP response returns immediately.
 */
export async function runDistributionInBackground(
  jobId: string,
  userId: string,
  r2ObjectKey: string,
  platformUploads: PlatformUpload[],
  metadataByPlatformId: Map<string, PlatformUploadMetadata>,
  options?: RunDistributionInBackgroundOptions
): Promise<void> {
  const attemptPlatformUploadIds = new Set(platformUploads.map((p) => p.id));
  const subsetRetry = options?.subsetRetry === true;
  const saApiKeyByPlatformUploadId = new Map<string, string>();
  try {
    await Promise.all(
      platformUploads.map((platformUpload) => {
        const meta = metadataByPlatformId.get(platformUpload.id);
        if (!meta) {
          throw new Error(`Missing merged metadata for platform upload ${platformUpload.id}`);
        }
        return runSinglePlatformUpload(
          userId,
          r2ObjectKey,
          platformUpload,
          meta,
          saApiKeyByPlatformUploadId
        );
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

    const nonCompleted = attemptResults.filter(
      (u) => !isPlatformUploadDistributionComplete(u.status)
    );
    if (nonCompleted.length > 0) {
      await updateUploadJobStatus(
        jobId,
        'failed',
        `Platform upload(s) not in completed state: ${nonCompleted.map((u) => `${u.platform}=${u.status}`).join('; ')}`
      );
      return;
    }

    if (subsetRetry) {
      const allLatest = latestPlatformUploadsPerPlatform(finalPlatformUploads);
      const stillIncomplete = allLatest.filter(
        (u) => !isPlatformUploadDistributionComplete(u.status)
      );
      if (stillIncomplete.length > 0) {
        const errorDetails = stillIncomplete
          .map((u) => `${u.platform}: ${u.status}${u.errorMessage ? ` — ${u.errorMessage}` : ''}`)
          .join('; ');
        await updateUploadJobStatus(
          jobId,
          'failed',
          `After retry, ${stillIncomplete.length} platform upload(s) still not completed: ${errorDetails}`
        );
        return;
      }
    }

    // All platform uploads succeeded — clean up the temporary R2 object.
    await deleteObject(r2ObjectKey).catch((cleanupError) => {
      console.error(
        `[distribute] Failed to delete temporary R2 object for job ${jobId}:`,
        cleanupError
      );
    });

    await updateUploadJobStatus(jobId, 'completed', null);

    for (const upload of attemptResults) {
      if (upload.platform !== 'sermon_audio') continue;

      const apiKey = saApiKeyByPlatformUploadId.get(upload.id);
      saApiKeyByPlatformUploadId.delete(upload.id);

      const sermonID = upload.platformVideoId.trim();
      if (!sermonID) continue;

      const meta = metadataByPlatformId.get(upload.id);
      if (meta?.autoPublishOnProcessed !== true) continue;

      if (!apiKey) {
        console.warn(
          `[distribute] Skipping SermonAudio auto-publish for platform_upload ${upload.id} (job ${jobId}): API key not captured during upload.`
        );
        continue;
      }

      // Auto-publish is a separate phase after the upload job is marked completed: SermonAudio
      // may need up to ~1 hour of processing polls before publish. Detached (not awaited) so
      // runDistributionInBackground returns promptly. Self-hosted Docker: the poll continues in
      // the long-lived Node process. Serverless: this work is outside `after()`'s awaited chain
      // and may be cut short; a persisted pending job plus queue/worker/cron would be needed for
      // guaranteed delivery across invocations.
      void (async () => {
        const platformUploadId = upload.id;
        const platformUrl = upload.platformUrl;
        try {
          await pollSermonAudioProcessing({
            sermonID,
            tokens: { accessToken: apiKey },
            customThumbnailUploaded: Boolean(meta?.thumbnailR2Key?.trim()),
          });
          await publishSermonAudio({
            sermonID,
            tokens: { accessToken: apiKey },
          });
          await updatePlatformUploadStatus(
            platformUploadId,
            'published',
            sermonID,
            platformUrl || undefined,
            null
          );
          const crossPublishActive = sermonAudioCrossPublishHasActiveSelection(meta?.crossPublish);
          console.log(
            `[distribute] SermonAudio sermon ${sermonID} published after processing (job ${jobId}, platform_upload ${platformUploadId})` +
              (crossPublishActive ? '; Cross Publish enabled' : '')
          );
        } catch (err) {
          console.error(
            `[distribute] SermonAudio auto-publish failed for platform_upload ${platformUploadId} (job ${jobId}, sermon ${sermonID}):`,
            err
          );
        }
      })();
    }

    // Best-effort: draft thumbnail cleanup must not fail the job (uploads already completed).
    // Capture the thumbnail key from the metadata snapshot used for this distribution so that
    // a replacement uploaded during the (potentially multi-minute) job is not accidentally deleted.
    const distributedThumbKey = [...metadataByPlatformId.values()].find(
      (m) => m.thumbnailR2Key
    )?.thumbnailR2Key;
    try {
      const jobRow = await getUploadJobById(jobId);
      const draftIdForThumb = jobRow?.draftId ?? null;
      if (!draftIdForThumb) {
        return;
      }
      const draftForThumb = await getDraftById(draftIdForThumb);
      const thumbKey = draftForThumb?.thumbnailR2Key;
      if (!thumbKey || draftForThumb?.userId !== userId) {
        return;
      }
      // If this job had no thumbnail, there is nothing to clean up — and we must not delete
      // a thumbnail the user added after distribution started.
      if (!distributedThumbKey) {
        return;
      }
      // If the user replaced the thumbnail while distribution was running, the current key will
      // differ from the one that was actually distributed; skip cleanup to avoid deleting it.
      if (thumbKey !== distributedThumbKey) {
        return;
      }
      const keyMatchesDraftThumbnailPrefix = isDraftThumbnailFinalKeyForUser(
        thumbKey,
        userId,
        draftIdForThumb
      );
      if (!keyMatchesDraftThumbnailPrefix) {
        console.warn(
          `[distribute] Skipped draft thumbnail cleanup for draft ${draftIdForThumb} (unexpected key prefix; job ${jobId}); retaining key for later manual cleanup.`
        );
        return;
      }

      // Clear draft fields first (DB-first ordering, consistent with DELETE /api/drafts/:id/thumbnail).
      // If updateDraft fails, the draft retains the key and the R2 object is still intact,
      // so there is no stale-key corruption. If deleteObject later fails, the draft is already
      // clean and the orphaned object can be swept up later.
      const MAX_UPDATE_DRAFT_ATTEMPTS = 3;
      let draftCleared = false;
      for (let attempt = 1; attempt <= MAX_UPDATE_DRAFT_ATTEMPTS; attempt++) {
        try {
          await updateDraft(draftIdForThumb, {
            thumbnailR2Key: null,
            thumbnailContentType: null,
          });
          draftCleared = true;
          break;
        } catch (updateErr) {
          if (attempt < MAX_UPDATE_DRAFT_ATTEMPTS) {
            await new Promise<void>((resolve) => setTimeout(resolve, 500 * attempt));
          } else {
            console.error(
              `[distribute] Failed to clear thumbnail fields on draft ${draftIdForThumb} ` +
                `(key "${thumbKey}") after ${MAX_UPDATE_DRAFT_ATTEMPTS} attempts ` +
                `(job ${jobId}); retaining R2 key for retry.`,
              updateErr
            );
          }
        }
      }
      if (!draftCleared) {
        // Retain key/type so the next cleanup attempt can still find and delete the R2 object.
        return;
      }

      // Best-effort R2 delete after confirmed DB clear.
      try {
        await deleteObject(thumbKey);
      } catch (thumbErr) {
        console.error(`[distribute] Failed to delete draft thumbnail for job ${jobId}:`, thumbErr);
      }
    } catch (thumbCleanupErr) {
      console.error(
        `[distribute] Draft thumbnail cleanup failed after job ${jobId} completed (non-fatal):`,
        thumbCleanupErr
      );
    }
  } catch (error) {
    console.error(`[distribute] Background distribution failed for job ${jobId}:`, error);
    await updateUploadJobStatus(
      jobId,
      'failed',
      error instanceof Error ? error.message : 'Distribution failed unexpectedly'
    ).catch((updateError) => {
      console.error(`[distribute] Failed to mark job ${jobId} as failed:`, updateError);
    });
  } finally {
    saApiKeyByPlatformUploadId.clear();
  }
}
