import { DEFAULT_YOUTUBE_VIDEO_CATEGORY_ID } from '@/lib/platforms/youtube-livestream-api';
import type { YouTubeLivestreamFields, YouTubeUserDefaults } from '@/types';

/**
 * Resolves the YouTube category id to apply when syncing a livestream broadcast.
 * Uses the livestream row first, then saved profile defaults, then People & Blogs.
 * @param youtube - `platforms.youtube` on the livestream row.
 * @param profileDefaults - Saved `platformDefaults.youtube` for the user.
 * @returns Numeric YouTube category id string.
 */
export function resolveYouTubeCategoryIdForLivestreamSync(
  youtube: YouTubeLivestreamFields | undefined,
  profileDefaults: YouTubeUserDefaults | undefined
): string {
  const fromPlatform = youtube?.categoryId?.trim();
  if (fromPlatform) {
    return fromPlatform;
  }

  const fromProfile = profileDefaults?.categoryId?.trim();
  if (fromProfile) {
    return fromProfile;
  }

  return DEFAULT_YOUTUBE_VIDEO_CATEGORY_ID;
}
