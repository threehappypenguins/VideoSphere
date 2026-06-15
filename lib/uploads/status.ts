import type { ConnectedAccountPlatform, PlatformUploadStatus } from '@/types';

/**
 * Client-only mirror of `SERMONAUDIO_PROCESSING_POLL_INTERVAL_MS` in `lib/platforms/sermon-audio.ts`.
 * Duplicated here so this module stays browser-safe (sermon-audio imports R2 / Node streams).
 */
const SERMONAUDIO_UI_PROCESSING_POLL_INTERVAL_MS = 30_000;

/**
 * Client-only mirror of `SERMONAUDIO_PROCESSING_MAX_ATTEMPTS` in `lib/platforms/sermon-audio.ts`.
 * Duplicated here so this module stays browser-safe (sermon-audio imports R2 / Node streams).
 */
const SERMONAUDIO_UI_PROCESSING_MAX_ATTEMPTS = 120;

/**
 * Stop UI polling for SermonAudio auto-publish after the server-side processing budget
 * ({@link SERMONAUDIO_UI_PROCESSING_MAX_ATTEMPTS} × {@link SERMONAUDIO_UI_PROCESSING_POLL_INTERVAL_MS}
 * ≈ 1 hour) plus a 15-minute buffer. Rows older than this with no status change are treated as
 * terminal so stuck historical jobs do not poll forever.
 */
export const SERMONAUDIO_AUTO_PUBLISH_UI_STALE_MS =
  SERMONAUDIO_UI_PROCESSING_MAX_ATTEMPTS * SERMONAUDIO_UI_PROCESSING_POLL_INTERVAL_MS + 15 * 60_000;

/**
 * Minimal platform upload snapshot for polling and deduplicating latest status per platform.
 * Used by {@link latestPlatformStatuses} and {@link isPlatformUploadRowActive} consumers.
 * @property platform - Target platform for this upload row.
 * @property status - Current platform upload lifecycle status.
 * @property updatedAt - ISO timestamp of the row’s last update (for latest-wins merging).
 * @property sermonAudioAutoPublishOnProcessed - When platform is `sermon_audio`, whether auto-publish was enabled for this distribute snapshot.
 */
export type PlatformStatusItem = {
  platform: ConnectedAccountPlatform;
  status: PlatformUploadStatus;
  updatedAt: string;
  sermonAudioAutoPublishOnProcessed?: boolean;
};

/**
 * True when bytes were successfully sent to the platform (terminal upload outcome, excluding failure).
 * SermonAudio stops at `unpublished` or `published`; other platforms use `completed`.
 * @param status - Platform upload row status.
 * @returns Whether distribution finished without error.
 */
export function isPlatformUploadDistributionComplete(status: PlatformUploadStatus): boolean {
  return status === 'completed' || status === 'unpublished' || status === 'published';
}

/**
 * True when a platform upload row may still change without user action (upload in flight).
 * `unpublished` is terminal when SermonAudio auto-publish is disabled; use
 * {@link isSermonAudioAwaitingAutoPublish} when the API exposes whether publish is pending.
 * @param status - Platform upload row status.
 * @returns Whether the row is still in progress.
 */
export function isPlatformUploadStatusInProgress(status: PlatformUploadStatus): boolean {
  return status === 'pending' || status === 'uploading';
}

/**
 * True when a SermonAudio row is uploaded but auto-publish is still expected to run in the background.
 * @param status - Platform upload row status.
 * @param autoPublishOnProcessed - Whether auto-publish was enabled for this distribute snapshot.
 * @returns Whether the UI should keep polling for a transition to `published`.
 */
export function isSermonAudioAwaitingAutoPublish(
  status: PlatformUploadStatus,
  autoPublishOnProcessed: boolean
): boolean {
  return status === 'unpublished' && autoPublishOnProcessed;
}

/**
 * True when a platform upload row may still change without user action.
 * @param input - Platform, status, and SermonAudio auto-publish snapshot when platform is `sermon_audio`.
 * @returns Whether consumers should keep polling this row.
 */
export function isPlatformUploadRowActive(input: {
  platform: ConnectedAccountPlatform;
  status: PlatformUploadStatus;
  sermonAudioAutoPublishOnProcessed?: boolean;
  /** ISO timestamp of the platform row; used to stop polling stale SermonAudio auto-publish waits. */
  updatedAt?: string;
}): boolean {
  if (isPlatformUploadStatusInProgress(input.status)) return true;
  if (input.platform === 'sermon_audio') {
    if (
      !isSermonAudioAwaitingAutoPublish(
        input.status,
        input.sermonAudioAutoPublishOnProcessed === true
      )
    ) {
      return false;
    }
    if (input.updatedAt) {
      const ts = Date.parse(input.updatedAt);
      if (!Number.isNaN(ts) && Date.now() - ts > SERMONAUDIO_AUTO_PUBLISH_UI_STALE_MS) {
        return false;
      }
    }
    return true;
  }
  return false;
}

/**
 * For each platform, return the most recently updated status.
 * Timestamps are ISO strings, so we compare using `Date.parse`.
 */
export function latestPlatformStatuses(platforms: PlatformStatusItem[]): PlatformStatusItem[] {
  const byPlatform = new Map<ConnectedAccountPlatform, PlatformStatusItem>();

  for (const item of platforms) {
    const current = byPlatform.get(item.platform);
    if (!current) {
      byPlatform.set(item.platform, item);
      continue;
    }

    const currentTs = Date.parse(current.updatedAt);
    const nextTs = Date.parse(item.updatedAt);
    if (Number.isNaN(currentTs) || (!Number.isNaN(nextTs) && nextTs >= currentTs)) {
      byPlatform.set(item.platform, item);
    }
  }

  return Array.from(byPlatform.values());
}
