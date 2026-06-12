import type { ConnectedAccountPlatform, PlatformUploadStatus } from '@/types';

/**
 * Defines the PlatformStatusItem type.
 */
export type PlatformStatusItem = {
  platform: ConnectedAccountPlatform;
  status: PlatformUploadStatus;
  updatedAt: string;
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
 * True when a platform upload row may still change without user action (upload or SA auto-publish in flight).
 * @param status - Platform upload row status.
 * @returns Whether the row is still in progress.
 */
export function isPlatformUploadStatusInProgress(status: PlatformUploadStatus): boolean {
  return status === 'pending' || status === 'uploading' || status === 'unpublished';
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
