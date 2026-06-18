import type { ConnectedAccountPlatform } from '@/types';
import { platformLabel } from '@/lib/ui/platform-label';

/** Video distribution platforms shown under the Video Platforms section. */
export const VIDEO_PLATFORMS = [
  'youtube',
  'vimeo',
  'sermon_audio',
  'facebook',
] as const satisfies readonly ConnectedAccountPlatform[];

/** Backup destinations shown under the Backup section. */
export const BACKUP_PLATFORMS = [
  'google_drive',
  'sftp',
  'smb',
] as const satisfies readonly ConnectedAccountPlatform[];

/**
 * Sorts platforms alphabetically by their display label.
 * @param platforms - Platforms to sort.
 * @returns Platforms sorted A–Z by label.
 */
export function sortPlatformsAlphabetically(
  platforms: readonly ConnectedAccountPlatform[]
): ConnectedAccountPlatform[] {
  return [...platforms].sort((a, b) =>
    platformLabel(a).localeCompare(platformLabel(b), undefined, { sensitivity: 'base' })
  );
}

/**
 * Splits a platform list into Video Platforms and Backup subsets, each sorted alphabetically.
 * @param platforms - Platforms to group (typically the platforms visible in a draft or list UI).
 * @returns Video and backup platform lists for section rendering.
 */
export function groupPlatformsBySection(platforms: readonly ConnectedAccountPlatform[]): {
  videoPlatforms: ConnectedAccountPlatform[];
  backupPlatforms: ConnectedAccountPlatform[];
} {
  const availableSet = new Set(platforms);

  return {
    videoPlatforms: sortPlatformsAlphabetically(
      VIDEO_PLATFORMS.filter((platform) => availableSet.has(platform))
    ),
    backupPlatforms: sortPlatformsAlphabetically(
      BACKUP_PLATFORMS.filter((platform) => availableSet.has(platform))
    ),
  };
}
