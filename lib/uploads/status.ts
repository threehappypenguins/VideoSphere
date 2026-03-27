import type { ConnectedAccountPlatform, PlatformUploadStatus } from '@/types';

export type PlatformStatusItem = {
  platform: ConnectedAccountPlatform;
  status: PlatformUploadStatus;
  updatedAt: string;
};

/**
 * For each platform, return the most recently updated status.
 * Appwrite timestamps are ISO strings, so we compare using `Date.parse`.
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
