import {
  getDirectMediaUrl,
  type YouTubeDirectMediaUrl,
} from '@/lib/youtube-import/probe-keyframes';

const PREVIEW_CACHE_REFRESH_BUFFER_MS = 30_000;
/** Upper bound on cached preview URLs; entries are short-lived CDN links. */
const PREVIEW_CACHE_MAX_ENTRIES = 64;

const previewMediaCache = new Map<string, YouTubeDirectMediaUrl>();
let previewMediaCacheMaxEntriesForTests: number | null = null;

function previewMediaCacheKey(userId: string, youtubeVideoId: string): string {
  return `${userId}:${youtubeVideoId}`;
}

function getPreviewMediaCacheMaxEntries(): number {
  return previewMediaCacheMaxEntriesForTests ?? PREVIEW_CACHE_MAX_ENTRIES;
}

/**
 * Overrides the preview media cache size cap in unit tests.
 * @param maxEntries - Maximum entries, or `null` to restore the default.
 * @internal
 */
export function setPreviewMediaCacheMaxEntriesForTests(maxEntries: number | null): void {
  previewMediaCacheMaxEntriesForTests = maxEntries;
}

/**
 * Clears cached preview media URLs (tests only).
 */
export function clearPreviewMediaCacheForTests(): void {
  previewMediaCache.clear();
}

function evictExpiredPreviewMediaCacheEntries(now = Date.now()): void {
  const refreshDeadline = now + PREVIEW_CACHE_REFRESH_BUFFER_MS;
  for (const [key, value] of previewMediaCache) {
    if (value.expiresAt <= refreshDeadline) {
      previewMediaCache.delete(key);
    }
  }
}

function storePreviewMediaCacheEntry(cacheKey: string, resolved: YouTubeDirectMediaUrl): void {
  evictExpiredPreviewMediaCacheEntries();
  const maxEntries = getPreviewMediaCacheMaxEntries();
  while (previewMediaCache.size >= maxEntries) {
    const oldestKey = previewMediaCache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    previewMediaCache.delete(oldestKey);
  }
  previewMediaCache.set(cacheKey, resolved);
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

  storePreviewMediaCacheEntry(cacheKey, resolved);
  return resolved;
}
