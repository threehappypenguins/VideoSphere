import type { Livestream } from '@/types';

/**
 * Builds a cache-busted preview URL for a YouTube-hosted thumbnail image.
 * YouTube often reuses the same CDN path when a custom thumbnail is replaced.
 * @param thumbnailUrl - Stored YouTube thumbnail URL.
 * @param cacheKey - Value that changes when the thumbnail changes (e.g. ISO timestamp).
 * @returns URL with a `vs` query parameter for browser cache busting.
 */
export function youtubeThumbnailPreviewUrl(thumbnailUrl: string, cacheKey: string): string {
  const trimmedUrl = thumbnailUrl.trim();
  const trimmedKey = cacheKey.trim();
  if (!trimmedUrl || !trimmedKey) {
    return trimmedUrl;
  }

  try {
    const url = new URL(trimmedUrl);
    url.searchParams.set('vs', trimmedKey);
    return url.toString();
  } catch {
    const separator = trimmedUrl.includes('?') ? '&' : '?';
    return `${trimmedUrl}${separator}vs=${encodeURIComponent(trimmedKey)}`;
  }
}

/**
 * Resolves the cache-bust key for a livestream YouTube thumbnail preview.
 * @param livestream - Livestream row with optional YouTube thumbnail metadata.
 * @returns ISO timestamp string when available.
 */
export function livestreamYouTubeThumbnailCacheKey(livestream: {
  $updatedAt: string;
  platforms: { youtube?: { thumbnailUpdatedAt?: string } };
}): string {
  return livestream.platforms.youtube?.thumbnailUpdatedAt?.trim() || livestream.$updatedAt;
}

/**
 * Resolves a thumbnail URL for livestream list rows (R2 preview, stored YouTube URL, or broadcast id fallback).
 * @param livestream - Livestream row from the API.
 * @returns Thumbnail image URL when one can be derived.
 */
export function getLivestreamListThumbnailUrl(livestream: Livestream): string | undefined {
  const r2Preview = livestream.thumbnailPreviewUrl?.trim();
  if (r2Preview) {
    return r2Preview;
  }

  const youtubeThumbnailUrl = livestream.platforms.youtube?.thumbnailUrl?.trim();
  if (youtubeThumbnailUrl) {
    return youtubeThumbnailPreviewUrl(
      youtubeThumbnailUrl,
      livestreamYouTubeThumbnailCacheKey(livestream)
    );
  }

  const broadcastId = livestream.youtubeBroadcastId?.trim();
  if (broadcastId) {
    return `https://i.ytimg.com/vi/${broadcastId}/hqdefault.jpg`;
  }

  return undefined;
}
