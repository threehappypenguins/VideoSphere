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
import { Readable } from 'node:stream';
import {
  buildBackupFileName,
  normalizeBackupFileNameSettings,
  resolveBackupYearFolderName,
} from '@/lib/backup-filename';
import {
  createSharedBackupMetadataSession,
  prepareBackupMetadataVideoForUpload,
  resolveBackupInjectedMetadata,
  shouldInjectBackupMetadata,
  type BackupInjectedMetadata,
  type PreparedBackupMetadataVideo,
  type SharedBackupMetadataSession,
} from '@/lib/backup-metadata';
import { buildMetadataForPlatform } from '@/lib/draft-upload-metadata';
import { isDraftThumbnailPlatform } from '@/lib/draft-thumbnail';
import type { PlatformUploadMetadata } from '@/lib/platforms/types';
import {
  deleteObject,
  getObjectNodeStream,
  getObjectWebStream,
  headObjectMetadata,
  isDraftThumbnailFinalKeyForUser,
} from '@/lib/r2';
import { getDraftById, updateDraft, type UpdateDraftInput } from '@/lib/repositories/drafts';
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
          ...(meta.vimeoCategoryUris !== undefined && meta.vimeoCategoryUris.length > 0
            ? { vimeoCategoryUris: meta.vimeoCategoryUris }
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

function sermonAudioAutoPublishErrorMessage(err: unknown): string {
  const detail = messageFromThrown(err);
  if (err instanceof Error && 'code' in err && typeof err.code === 'string' && err.code.trim()) {
    return `${err.code}: ${detail}`;
  }
  return detail;
}

async function persistSermonAudioAutoPublishFailure(
  platformUploadId: string,
  sermonID: string,
  platformUrl: string,
  errorMessage: string
): Promise<void> {
  try {
    const updated = await updatePlatformUploadStatus(
      platformUploadId,
      'failed',
      sermonID,
      platformUrl || undefined,
      errorMessage
    );
    if (updated === null) {
      console.error(
        `[distribute] Could not persist SermonAudio auto-publish failure for platform_upload ${platformUploadId}: row missing`
      );
    }
  } catch (updateErr) {
    console.error(
      `[distribute] Could not persist SermonAudio auto-publish failure for platform_upload ${platformUploadId}:`,
      updateErr
    );
  }
}

/**
 * Starts poll-and-publish work for SermonAudio rows that uploaded successfully in this attempt.
 * Runs independently of whether other platforms on the same job failed.
 * Immediate failures (e.g. missing API key) are awaited so rows leave `unpublished` before the
 * caller continues; long-running poll/publish work remains detached (see inline note below).
 */
async function startSermonAudioAutoPublishForSuccessfulUploads(
  jobId: string,
  attemptResults: PlatformUpload[],
  metadataByPlatformId: Map<string, PlatformUploadMetadata>,
  saApiKeyByPlatformUploadId: ReadonlyMap<string, string>,
  saCustomThumbnailUploadedByPlatformUploadId: ReadonlyMap<string, boolean>
): Promise<void> {
  const immediateFailureWrites: Promise<void>[] = [];

  for (const upload of attemptResults) {
    if (upload.platform !== 'sermon_audio' || upload.status !== 'unpublished') {
      continue;
    }

    const apiKey = saApiKeyByPlatformUploadId.get(upload.id);
    const customThumbnailUploaded =
      saCustomThumbnailUploadedByPlatformUploadId.get(upload.id) === true;

    const sermonID = upload.platformVideoId.trim();
    if (!sermonID) continue;

    const meta = metadataByPlatformId.get(upload.id);
    if (meta?.autoPublishOnProcessed !== true) continue;

    if (!apiKey) {
      console.warn(
        `[distribute] Skipping SermonAudio auto-publish for platform_upload ${upload.id} (job ${jobId}): API key not captured during upload.`
      );
      immediateFailureWrites.push(
        persistSermonAudioAutoPublishFailure(
          upload.id,
          sermonID,
          upload.platformUrl,
          'SermonAudio API key was not captured during upload; auto-publish could not run.'
        )
      );
      continue;
    }

    // Detached (not awaited): SermonAudio may need up to ~1 hour of processing polls before publish.
    // This is intentionally outside the awaited distribution chain so job completion and R2 cleanup
    // are not blocked. Delivery is best-effort: if the Node process exits (deploy, crash, scale-in)
    // before the detached task finishes, the row can remain `unpublished` until the user retries or
    // publishes manually. Hosts that freeze the runtime when the request/`after()` callback ends
    // (typical serverless) are especially affected; long-lived containers usually keep the event
    // loop running, but still offer no durability guarantee without a queue/worker.
    void (async () => {
      const platformUploadId = upload.id;
      const platformUrl = upload.platformUrl;
      try {
        await pollSermonAudioProcessing({
          sermonID,
          tokens: { accessToken: apiKey },
          customThumbnailUploaded,
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
        await persistSermonAudioAutoPublishFailure(
          platformUploadId,
          sermonID,
          platformUrl,
          sermonAudioAutoPublishErrorMessage(err)
        );
      }
    })();
  }

  await Promise.all(immediateFailureWrites);
}

// ---------------------------------------------------------------------------
// Shared backup metadata (one ffmpeg pass per job)
// ---------------------------------------------------------------------------

function isBackupPlatform(
  platform: ConnectedAccountPlatform
): platform is 'google_drive' | 'sftp' | 'smb' {
  return platform === 'google_drive' || platform === 'sftp' || platform === 'smb';
}

function backupInjectedMetadataMatches(
  left: BackupInjectedMetadata,
  right: BackupInjectedMetadata
): boolean {
  return (
    left.title === right.title &&
    left.albumArtist === right.albumArtist &&
    left.album === right.album &&
    left.genre === right.genre &&
    left.year === right.year
  );
}

/**
 * When any backup target needs metadata injection, prepares a shared session so Drive/SFTP/SMB
 * fan out from a single R2 download and ffmpeg pass instead of one per platform.
 * Returns null when backup targets resolve different injectable metadata (e.g. per-platform
 * title overrides), since a single ffmpeg output can only embed one title atom.
 */
async function createSharedBackupMetadataSessionForJob(
  r2ObjectKey: string,
  platformUploads: PlatformUpload[],
  metadataByPlatformId: Map<string, PlatformUploadMetadata>
): Promise<SharedBackupMetadataSession | null> {
  const backupUploads = platformUploads.filter((platformUpload) =>
    isBackupPlatform(platformUpload.platform)
  );
  if (backupUploads.length === 0) {
    return null;
  }

  const backupMetas = backupUploads
    .map((platformUpload) => metadataByPlatformId.get(platformUpload.id))
    .filter((meta): meta is PlatformUploadMetadata => meta != null);

  if (backupMetas.length === 0) {
    return null;
  }

  const referenceMeta = backupMetas[0];
  if (normalizeBackupFileNameSettings(referenceMeta.backupNaming).metadataEnabled !== true) {
    return null;
  }

  const injectedMetadata = resolveBackupInjectedMetadata({
    title: referenceMeta.title,
    settings: referenceMeta.backupNaming,
  });

  const allShareInjectedMetadata = backupMetas.every((meta) =>
    backupInjectedMetadataMatches(
      injectedMetadata,
      resolveBackupInjectedMetadata({
        title: meta.title,
        settings: meta.backupNaming,
      })
    )
  );

  if (!allShareInjectedMetadata) {
    return null;
  }

  const objectMeta = await headObjectMetadata(r2ObjectKey);

  return createSharedBackupMetadataSession({
    openSource: (signal) => getObjectNodeStream(r2ObjectKey, { signal }),
    expectedContentLength: objectMeta.contentLength,
    sourceContentType: objectMeta.contentType,
    backupNaming: referenceMeta.backupNaming,
    injectedMetadata,
  });
}

// ---------------------------------------------------------------------------
// Single-platform upload
// ---------------------------------------------------------------------------

async function runSinglePlatformUpload(
  userId: string,
  r2ObjectKey: string,
  platformUpload: PlatformUpload,
  metadata: PlatformUploadMetadata,
  saApiKeyByPlatformUploadId: Map<string, string>,
  saCustomThumbnailUploadedByPlatformUploadId: Map<string, boolean>,
  sharedBackupMetadataSession: SharedBackupMetadataSession | null
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
      if (isBackupPlatform(platformUpload.platform)) {
        let videoStream: ReadableStream<Uint8Array>;
        let uploadContentLength: number;
        let uploadContentType: string;
        let preparedMetadata: PreparedBackupMetadataVideo | null = null;

        try {
          if (sharedBackupMetadataSession) {
            const prepared = await sharedBackupMetadataSession.openUploadStream(signal);
            videoStream = prepared.stream;
            uploadContentLength = prepared.contentLength;
            uploadContentType = prepared.contentType;
          } else {
            const nodeObject = await getObjectNodeStream(r2ObjectKey, { signal });
            uploadContentLength = nodeObject.contentLength;
            uploadContentType = nodeObject.contentType;

            if (shouldInjectBackupMetadata(metadata.backupNaming, nodeObject.contentType)) {
              preparedMetadata = await prepareBackupMetadataVideoForUpload({
                source: nodeObject.readable,
                expectedContentLength: nodeObject.contentLength,
                sourceContentType: nodeObject.contentType,
                metadata: resolveBackupInjectedMetadata({
                  title: metadata.title,
                  settings: metadata.backupNaming,
                }),
                signal,
              });
              videoStream = preparedMetadata.stream;
              uploadContentLength = preparedMetadata.contentLength;
              uploadContentType = preparedMetadata.contentType;
            } else {
              videoStream = Readable.toWeb(nodeObject.readable) as ReadableStream<Uint8Array>;
            }
          }

          const fileName = buildBackupFileName({
            title: metadata.title,
            contentType: uploadContentType,
            settings: metadata.backupNaming,
          });
          const yearFolderName = resolveBackupYearFolderName(metadata.backupNaming);

          if (platformUpload.platform === 'google_drive') {
            return uploadToGoogleDrive({
              connectedAccount,
              videoStream,
              contentLength: uploadContentLength,
              contentType: uploadContentType,
              fileName,
              yearFolderName,
              tokens,
              signal,
            });
          }

          if (platformUpload.platform === 'sftp') {
            return uploadToSftp({
              connectedAccount,
              videoStream,
              contentLength: uploadContentLength,
              contentType: uploadContentType,
              fileName,
              yearFolderName,
              signal,
            });
          }

          return uploadToSmb({
            connectedAccount,
            videoStream,
            contentLength: uploadContentLength,
            contentType: uploadContentType,
            fileName,
            yearFolderName,
            signal,
          });
        } finally {
          await preparedMetadata?.dispose();
        }
      }

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

      // Exhaustive platform check — TypeScript error if a platform lacks an upload path.
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

    if (
      platformUpload.platform === 'sermon_audio' &&
      uploadResult.sermonAudioCustomThumbnailUploaded === true
    ) {
      saCustomThumbnailUploadedByPlatformUploadId.set(platformUpload.id, true);
    }
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

const MAX_DRAFT_THUMBNAIL_UPDATE_ATTEMPTS = 3;

/**
 * Clears distributed draft thumbnail keys from the draft document and deletes the R2 objects.
 * Uses the metadata snapshot from this distribution attempt so thumbnails replaced mid-upload
 * are not removed. Clears shared `thumbnailR2Key` with `null` and per-platform overrides with
 * `''` so platforms do not fall back to a shared thumbnail that was not distributed.
 * @param jobId - Upload job id (for logging).
 * @param userId - Draft owner.
 * @param draftId - Draft whose thumbnails were distributed.
 * @param platformUploads - Platform upload rows included in this distribution attempt.
 * @param metadataByPlatformId - Metadata snapshot keyed by platform upload id.
 */
async function cleanupDistributedDraftThumbnails(
  jobId: string,
  userId: string,
  draftId: string,
  platformUploads: PlatformUpload[],
  metadataByPlatformId: Map<string, PlatformUploadMetadata>
): Promise<void> {
  const draft = await getDraftById(draftId);
  if (!draft || draft.userId !== userId) {
    return;
  }

  const distributedByKey = new Map<string, Set<PlatformUpload['platform']>>();
  for (const upload of platformUploads) {
    const key = metadataByPlatformId.get(upload.id)?.thumbnailR2Key?.trim();
    if (!key) {
      continue;
    }
    const platforms = distributedByKey.get(key) ?? new Set<PlatformUpload['platform']>();
    platforms.add(upload.platform);
    distributedByKey.set(key, platforms);
  }

  if (distributedByKey.size === 0) {
    return;
  }

  let clearSharedThumbnail = false;
  const platformsPatch: NonNullable<UpdateDraftInput['platformsPatch']> = {};
  const keysToDelete = new Set<string>();

  for (const [key, platforms] of distributedByKey) {
    if (!isDraftThumbnailFinalKeyForUser(key, userId, draftId)) {
      console.warn(
        `[distribute] Skipped draft thumbnail cleanup for draft ${draftId} (unexpected key prefix "${key}"; job ${jobId}); retaining key for later manual cleanup.`
      );
      continue;
    }

    let shouldDeleteKey = false;

    if (draft.thumbnailR2Key === key) {
      clearSharedThumbnail = true;
      shouldDeleteKey = true;
    }

    for (const platform of platforms) {
      if (!isDraftThumbnailPlatform(platform)) {
        continue;
      }
      if (draft.platforms[platform]?.thumbnailR2KeyOverride === key) {
        platformsPatch[platform] = {
          thumbnailR2KeyOverride: '',
          thumbnailContentTypeOverride: '',
        };
        shouldDeleteKey = true;
      }
    }

    if (shouldDeleteKey) {
      keysToDelete.add(key);
    }
  }

  if (!clearSharedThumbnail && Object.keys(platformsPatch).length === 0) {
    return;
  }

  const updateInput: UpdateDraftInput = {};
  if (clearSharedThumbnail) {
    updateInput.thumbnailR2Key = null;
    updateInput.thumbnailContentType = null;
  }
  if (Object.keys(platformsPatch).length > 0) {
    updateInput.platformsPatch = platformsPatch;
  }

  let draftCleared = false;
  for (let attempt = 1; attempt <= MAX_DRAFT_THUMBNAIL_UPDATE_ATTEMPTS; attempt++) {
    try {
      await updateDraft(draftId, updateInput);
      draftCleared = true;
      break;
    } catch (updateErr) {
      if (attempt < MAX_DRAFT_THUMBNAIL_UPDATE_ATTEMPTS) {
        await new Promise<void>((resolve) => setTimeout(resolve, 500 * attempt));
      } else {
        console.error(
          `[distribute] Failed to clear thumbnail fields on draft ${draftId} after ${MAX_DRAFT_THUMBNAIL_UPDATE_ATTEMPTS} attempts (job ${jobId}); retaining R2 keys for retry.`,
          updateErr
        );
      }
    }
  }

  if (!draftCleared) {
    return;
  }

  for (const key of keysToDelete) {
    try {
      await deleteObject(key);
    } catch (thumbErr) {
      console.error(
        `[distribute] Failed to delete draft thumbnail "${key}" for job ${jobId}:`,
        thumbErr
      );
    }
  }
}

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
  const saCustomThumbnailUploadedByPlatformUploadId = new Map<string, boolean>();
  let sharedBackupMetadataSession: SharedBackupMetadataSession | null = null;
  try {
    sharedBackupMetadataSession = await createSharedBackupMetadataSessionForJob(
      r2ObjectKey,
      platformUploads,
      metadataByPlatformId
    );
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
          saApiKeyByPlatformUploadId,
          saCustomThumbnailUploadedByPlatformUploadId,
          sharedBackupMetadataSession
        );
      })
    );

    const finalPlatformUploads = await getPlatformUploadsByJob(jobId);
    const attemptResults = finalPlatformUploads.filter((u) => attemptPlatformUploadIds.has(u.id));

    await startSermonAudioAutoPublishForSuccessfulUploads(
      jobId,
      attemptResults,
      metadataByPlatformId,
      saApiKeyByPlatformUploadId,
      saCustomThumbnailUploadedByPlatformUploadId
    );

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
        `Platform upload(s) not in a terminal distribution state: ${nonCompleted.map((u) => `${u.platform}=${u.status}`).join('; ')}`
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
          `After retry, ${stillIncomplete.length} platform upload(s) still not in a terminal distribution state: ${errorDetails}`
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

    // Best-effort: draft thumbnail cleanup must not fail the job (uploads already completed).
    try {
      const jobRow = await getUploadJobById(jobId);
      const draftIdForThumb = jobRow?.draftId ?? null;
      if (draftIdForThumb) {
        await cleanupDistributedDraftThumbnails(
          jobId,
          userId,
          draftIdForThumb,
          platformUploads,
          metadataByPlatformId
        );
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
    await sharedBackupMetadataSession?.dispose();
  }
}
