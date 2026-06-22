import { getObjectUrl, isLivestreamThumbnailFinalKeyForUser } from '@/lib/r2';
import {
  livestreamYouTubeThumbnailCacheKey,
  youtubeThumbnailPreviewUrl,
} from '@/lib/livestreams/youtube-thumbnail-preview';
import type { Livestream } from '@/types';

/**
 * Attaches an ephemeral `thumbnailPreviewUrl` from R2 or a stored YouTube thumbnail URL.
 * @param livestream - Persisted livestream row.
 * @param userId - Owner user id.
 * @param livestreamId - Livestream row id.
 * @returns Livestream with optional preview URL for the editor UI.
 */
export async function livestreamWithThumbnailPreview(
  livestream: Livestream,
  userId: string,
  livestreamId: string
): Promise<Livestream> {
  const key = livestream.thumbnailR2Key;
  if (key && isLivestreamThumbnailFinalKeyForUser(key, userId, livestreamId)) {
    let thumbnailPreviewUrl: string | undefined;
    try {
      thumbnailPreviewUrl = await getObjectUrl(key);
    } catch {
      thumbnailPreviewUrl = undefined;
    }

    return {
      ...livestream,
      ...(thumbnailPreviewUrl ? { thumbnailPreviewUrl } : {}),
    };
  }

  const youtubeThumbnailUrl = livestream.platforms.youtube?.thumbnailUrl?.trim();
  if (youtubeThumbnailUrl) {
    return {
      ...livestream,
      thumbnailPreviewUrl: youtubeThumbnailPreviewUrl(
        youtubeThumbnailUrl,
        livestreamYouTubeThumbnailCacheKey(livestream)
      ),
    };
  }

  return livestream;
}
