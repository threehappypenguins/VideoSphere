import type { ConnectedAccountPlatform, PlatformUploadStatus } from '@/types';
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
}): boolean {
  if (isPlatformUploadStatusInProgress(input.status)) return true;
  if (input.platform === 'sermon_audio') {
    return isSermonAudioAwaitingAutoPublish(
      input.status,
      input.sermonAudioAutoPublishOnProcessed === true
    );
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
