import {
  getDirectMediaUrl,
  type YouTubeDirectMediaUrl,
} from '@/lib/youtube-import/probe-keyframes';

const PREVIEW_CACHE_REFRESH_BUFFER_MS = 30_000;

const previewMediaCache = new Map<string, YouTubeDirectMediaUrl>();

function previewMediaCacheKey(userId: string, youtubeVideoId: string): string {
  return `${userId}:${youtubeVideoId}`;
}

/**
 * Clears cached preview media URLs (tests only).
 */
export function clearPreviewMediaCacheForTests(): void {
  previewMediaCache.clear();
}

/**
 * Returns true when a yt-dlp media URL is safe to proxy for preview playback.
 * @param url - Direct media URL from yt-dlp metadata.
 * @returns Whether the host is an allowed YouTube CDN origin.
 */
export function isAllowedPreviewUpstreamUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === 'googlevideo.com' ||
      hostname.endsWith('.googlevideo.com') ||
      hostname === 'youtube.com' ||
      hostname.endsWith('.youtube.com')
    );
  } catch {
    return false;
  }
}

/**
 * Builds the authenticated preview stream path for a YouTube video id.
 * @param youtubeVideoId - 11-character YouTube video id.
 * @returns Same-origin preview stream URL for HTML5 video elements.
 */
export function buildYoutubeImportPreviewStreamPath(youtubeVideoId: string): string {
  return `/api/youtube-import/preview/stream?youtubeVideoId=${encodeURIComponent(youtubeVideoId)}`;
}

/**
 * Drops a cached preview media URL so the next request re-resolves via yt-dlp.
 * @param userId - Authenticated user id.
 * @param youtubeVideoId - YouTube video id.
 */
export function invalidatePreviewDirectMediaUrl(userId: string, youtubeVideoId: string): void {
  previewMediaCache.delete(previewMediaCacheKey(userId, youtubeVideoId));
}

/**
 * Resolves and caches a short-lived direct media URL for import preview playback.
 * @param userId - Authenticated user id.
 * @param youtubeVideoId - YouTube video id.
 * @param options - Optional cache-bypass flag.
 * @returns Direct media URL and approximate expiry timestamp.
 */
export async function resolvePreviewDirectMediaUrl(
  userId: string,
  youtubeVideoId: string,
  options?: { forceRefresh?: boolean }
): Promise<YouTubeDirectMediaUrl> {
  const cacheKey = previewMediaCacheKey(userId, youtubeVideoId);

  if (options?.forceRefresh) {
    previewMediaCache.delete(cacheKey);
  }

  const cached = previewMediaCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + PREVIEW_CACHE_REFRESH_BUFFER_MS) {
    return cached;
  }

  const resolved = await getDirectMediaUrl(youtubeVideoId);
  if (!isAllowedPreviewUpstreamUrl(resolved.url)) {
    throw new Error('Preview media URL is not from an allowed host');
  }

  previewMediaCache.set(cacheKey, resolved);
  return resolved;
}
