const YOUTUBE_VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const YOUTUBE_VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';

/** Default max source length when `YT_IMPORT_MAX_DURATION_SECONDS` is unset (4 hours). */
export const DEFAULT_YT_IMPORT_MAX_DURATION_SECONDS = 14_400;

/**
 * YouTube `videos.list` item shape used for import source resolution.
 */
export type YouTubeImportVideosListItem = {
  id?: string;
  snippet?: {
    title?: string;
    liveBroadcastContent?: string;
    thumbnails?: {
      high?: { url?: string };
      medium?: { url?: string };
      default?: { url?: string };
    };
  };
  contentDetails?: {
    duration?: string;
  };
  liveStreamingDetails?: {
    actualStartTime?: string;
    actualEndTime?: string;
  };
};

/**
 * Resolved metadata returned by the import resolve route.
 */
export interface YouTubeImportResolvedMetadata {
  youtubeVideoId: string;
  title: string;
  durationSeconds: number;
  thumbnailUrl: string;
}

/**
 * Full resolved import source including proxied preview stream details.
 */
export interface YouTubeImportResolvedSource extends YouTubeImportResolvedMetadata {
  /** Same-origin preview stream URL for the trim editor. */
  previewStreamUrl: string;
  /** Approximate Unix expiry for the proxied preview media URL. */
  previewExpiresAt: number;
}

/**
 * Parses a YouTube watch URL, short URL, `/live/` URL, or bare 11-character id.
 * @param input - User-provided URL or video id.
 * @returns The extracted video id, or `null` when unparseable.
 */
export function extractYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (YOUTUBE_VIDEO_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    const host = url.hostname.replace(/^www\./, '');

    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0] ?? '';
      return YOUTUBE_VIDEO_ID_PATTERN.test(id) ? id : null;
    }

    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (url.pathname === '/watch') {
        const id = url.searchParams.get('v')?.trim() ?? '';
        return YOUTUBE_VIDEO_ID_PATTERN.test(id) ? id : null;
      }

      const liveMatch = /^\/live\/([^/]+)/.exec(url.pathname);
      if (liveMatch) {
        const id = liveMatch[1] ?? '';
        return YOUTUBE_VIDEO_ID_PATTERN.test(id) ? id : null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Builds a canonical YouTube watch URL for a video id.
 * @param videoId - 11-character YouTube video id.
 * @returns Canonical `youtube.com/watch` URL.
 */
export function buildYouTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Parses a YouTube `contentDetails.duration` ISO-8601 value into seconds.
 * @param duration - ISO-8601 duration (for example `PT1H2M3S`).
 * @returns Duration in whole seconds, or `null` when invalid.
 */
export function parseIso8601DurationToSeconds(duration: string): number | null {
  const trimmed = duration.trim();
  if (!trimmed) {
    return null;
  }

  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(trimmed);
  if (!match || (match[1] == null && match[2] == null && match[3] == null)) {
    return null;
  }

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  if (![hours, minutes, seconds].every((value) => Number.isFinite(value) && value >= 0)) {
    return null;
  }

  return Math.floor(hours * 3600 + minutes * 60 + seconds);
}

/**
 * Reads the configured max import duration from the environment.
 * @returns Max allowed source duration in seconds.
 */
export function getYouTubeImportMaxDurationSeconds(): number {
  const raw = process.env.YT_IMPORT_MAX_DURATION_SECONDS;
  if (raw == null || raw.trim() === '') {
    return DEFAULT_YT_IMPORT_MAX_DURATION_SECONDS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_YT_IMPORT_MAX_DURATION_SECONDS;
  }

  return Math.floor(parsed);
}

/**
 * Returns true when a `videos.list` item is a completed live broadcast archive.
 * Rejects upcoming and in-progress live streams using the same signals as
 * {@link isYouTubeCompletedLiveArchiveVideo} in `lib/platforms/youtube-api.ts`.
 * @param video - `videos.list` item from the YouTube Data API.
 * @returns Whether the video can be imported as a completed broadcast.
 */
export function isYouTubeImportableCompletedBroadcast(video: YouTubeImportVideosListItem): boolean {
  const liveBroadcastContent = video.snippet?.liveBroadcastContent?.trim().toLowerCase();

  if (liveBroadcastContent === 'upcoming') {
    return false;
  }

  if (liveBroadcastContent === 'live') {
    return false;
  }

  const actualStartTime = video.liveStreamingDetails?.actualStartTime?.trim();
  const actualEndTime = video.liveStreamingDetails?.actualEndTime?.trim();
  return Boolean(actualStartTime && actualEndTime);
}

/**
 * Picks the best available thumbnail URL from a `videos.list` snippet.
 * @param video - `videos.list` item from the YouTube Data API.
 * @returns Thumbnail URL, or an empty string when none is present.
 */
export function pickYouTubeImportThumbnailUrl(video: YouTubeImportVideosListItem): string {
  const thumbnails = video.snippet?.thumbnails;
  const candidates = [thumbnails?.high?.url, thumbnails?.medium?.url, thumbnails?.default?.url];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate.trim();
    }
  }

  return '';
}

async function readYouTubeApiErrorDetails(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '');
  if (!raw.trim()) {
    return `YouTube API returned HTTP ${response.status}.`;
  }

  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    if (typeof parsed.error?.message === 'string' && parsed.error.message.trim() !== '') {
      return parsed.error.message.trim();
    }
  } catch {
    // Fall through to raw body text.
  }

  return raw.trim();
}

/**
 * Fetches a single YouTube video via `videos.list`.
 * @param accessToken - OAuth access token with YouTube read scope.
 * @param videoId - YouTube video id to resolve.
 * @param signal - Optional abort signal.
 * @returns The first matching video item, or upstream error details.
 */
export async function fetchYouTubeVideoForImport(
  accessToken: string,
  videoId: string,
  signal?: AbortSignal
): Promise<
  | { ok: true; item: YouTubeImportVideosListItem }
  | { ok: false; details: string; statusCode?: number; notFound?: boolean }
> {
  const url = new URL(YOUTUBE_VIDEOS_URL);
  url.searchParams.set('part', 'snippet,contentDetails,liveStreamingDetails,status');
  url.searchParams.set('id', videoId);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    return { ok: false, details: await readYouTubeApiErrorDetails(res), statusCode: res.status };
  }

  const body = (await res.json().catch(() => ({}))) as {
    items?: YouTubeImportVideosListItem[];
  };

  const item = body.items?.[0];
  if (!item) {
    return {
      ok: false,
      details: 'Video not found or not accessible with the connected YouTube account.',
      notFound: true,
    };
  }

  return { ok: true, item };
}

/**
 * Maps a `videos.list` item into import metadata after validation.
 * @param item - YouTube video resource from `videos.list`.
 * @returns Resolved metadata, or a human-readable validation error.
 */
export function mapYouTubeImportResolvedSource(
  item: YouTubeImportVideosListItem
): { ok: true; data: YouTubeImportResolvedMetadata } | { ok: false; message: string } {
  const youtubeVideoId = item.id?.trim() ?? '';
  if (!YOUTUBE_VIDEO_ID_PATTERN.test(youtubeVideoId)) {
    return { ok: false, message: 'YouTube returned an invalid video id.' };
  }

  if (!isYouTubeImportableCompletedBroadcast(item)) {
    return {
      ok: false,
      message: 'Only completed YouTube live broadcasts can be imported.',
    };
  }

  const durationSeconds = parseIso8601DurationToSeconds(item.contentDetails?.duration ?? '');
  if (durationSeconds == null) {
    return {
      ok: false,
      message: 'YouTube did not return a valid video duration.',
    };
  }

  const maxDurationSeconds = getYouTubeImportMaxDurationSeconds();
  if (durationSeconds > maxDurationSeconds) {
    return {
      ok: false,
      message: `Video exceeds the maximum import length of ${maxDurationSeconds} seconds.`,
    };
  }

  const title = item.snippet?.title?.trim() ?? '';
  const thumbnailUrl = pickYouTubeImportThumbnailUrl(item);

  return {
    ok: true,
    data: {
      youtubeVideoId,
      title,
      durationSeconds,
      thumbnailUrl,
    },
  };
}
