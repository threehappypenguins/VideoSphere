import type { ConnectedAccountPlatform } from '@/types';

/**
 * Newest row per platform (by `$updatedAt`) when multiple `platform_upload` rows exist.
 * Later `$updatedAt` wins; if the incumbent timestamp is unparseable, a parseable challenger replaces it.
 */
export function latestPlatformUploadsPerPlatform<
  T extends { platform: ConnectedAccountPlatform; $updatedAt: string },
>(platformUploads: T[]): T[] {
  const byPlatform = new Map<ConnectedAccountPlatform, T>();
  for (const item of platformUploads) {
    const current = byPlatform.get(item.platform);
    if (!current) {
      byPlatform.set(item.platform, item);
      continue;
    }
    const currentTs = Date.parse(current.$updatedAt);
    const nextTs = Date.parse(item.$updatedAt);
    if (Number.isNaN(currentTs) || (!Number.isNaN(nextTs) && nextTs >= currentTs)) {
      byPlatform.set(item.platform, item);
    }
  }
  return [...byPlatform.values()];
}
