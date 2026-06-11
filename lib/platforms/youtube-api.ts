import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getConnectedAccountWithTokens } from '@/lib/repositories/connected-accounts';
import {
  type YouTubeAccountDefaults,
  buildYouTubeAccountDefaultsSeedPatch,
} from '@/lib/platforms/youtube-account-defaults';
import { refreshTokenIfNeeded } from '@/lib/platforms/token-refresh';
import type { ApiError } from '@/types';

export type { YouTubeAccountDefaults };
export { buildYouTubeAccountDefaultsSeedPatch };

const YOUTUBE_VIDEO_CATEGORIES_URL = 'https://www.googleapis.com/youtube/v3/videoCategories';
const YOUTUBE_I18N_LANGUAGES_URL = 'https://www.googleapis.com/youtube/v3/i18nLanguages';
const YOUTUBE_CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels';
const YOUTUBE_VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
const YOUTUBE_PLAYLIST_ITEMS_URL = 'https://www.googleapis.com/youtube/v3/playlistItems';

type YouTubeConnectionResult =
  | { ok: true; accessToken: string }
  | { ok: false; response: NextResponse };

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
 * Builds a 502 response for a failed YouTube Data API request.
 * @param details - Upstream error message or body text.
 * @returns JSON error response for route handlers.
 */
export function youtubeUpstreamErrorResponse(details: string): NextResponse {
  const errRes: ApiError = {
    error: 'Bad Gateway',
    message: details,
    statusCode: 502,
  };
  return NextResponse.json(errRes, { status: 502 });
}

/**
 * Builds a 401 response for missing session auth or token refresh failure.
 * @param message - Human-readable failure reason.
 * @returns JSON error response for route handlers.
 */
export function youtubeAuthErrorResponse(message: string): NextResponse {
  const errRes: ApiError = {
    error: 'Unauthorized',
    message,
    statusCode: 401,
  };
  return NextResponse.json(errRes, { status: 401 });
}

/**
 * Resolves the authenticated user's YouTube connection and a fresh access token.
 * @param req - Incoming request (session auth).
 * @returns Access token for YouTube Data API calls, or an error response.
 */
export async function requireYouTubeConnection(req: NextRequest): Promise<YouTubeConnectionResult> {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return { ok: false, response: youtubeAuthErrorResponse('Not authenticated') };
  }

  const account = await getConnectedAccountWithTokens(userId, 'youtube');
  if (!account) {
    return { ok: false, response: youtubeAuthErrorResponse('YouTube is not connected') };
  }

  try {
    const tokens = await refreshTokenIfNeeded(account);
    const accessToken = tokens.accessToken.trim();
    if (!accessToken) {
      return {
        ok: false,
        response: youtubeAuthErrorResponse(
          'YouTube access token is missing. Reconnect your YouTube account.'
        ),
      };
    }
    return { ok: true, accessToken };
  } catch (err) {
    const message =
      err instanceof Error && err.message.trim() !== ''
        ? err.message.trim()
        : 'Failed to refresh YouTube access token. Reconnect your YouTube account.';
    return { ok: false, response: youtubeAuthErrorResponse(message) };
  }
}

/**
 * Fetches assignable YouTube video categories for the US region (`videoCategories.list`).
 * @param accessToken - OAuth access token with YouTube read scope.
 * @param signal - Optional abort signal.
 * @returns Category id/title rows, or upstream error details.
 */
export async function fetchYouTubeVideoCategories(
  accessToken: string,
  signal?: AbortSignal
): Promise<
  { ok: true; items: Array<{ id: string; title: string }> } | { ok: false; details: string }
> {
  const url = new URL(YOUTUBE_VIDEO_CATEGORIES_URL);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('regionCode', 'US');
  url.searchParams.set('hl', 'en');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    return { ok: false, details: await readYouTubeApiErrorDetails(res) };
  }

  const body = (await res.json().catch(() => ({}))) as {
    items?: Array<{ id?: string; snippet?: { title?: string; assignable?: boolean } }>;
  };

  const items = (body.items ?? [])
    .filter((item) => item.snippet?.assignable === true)
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id : '',
      title: typeof item.snippet?.title === 'string' ? item.snippet.title : '',
    }))
    .filter((item) => item.id.length > 0 && item.title.length > 0);

  return { ok: true, items };
}

/**
 * Fetches supported YouTube i18n languages (`i18nLanguages.list`), sorted by display name.
 * @param accessToken - OAuth access token with YouTube read scope.
 * @param signal - Optional abort signal.
 * @returns Language BCP-47 id and English display name rows.
 */
export async function fetchYouTubeI18nLanguages(
  accessToken: string,
  signal?: AbortSignal
): Promise<
  { ok: true; items: Array<{ id: string; name: string }> } | { ok: false; details: string }
> {
  const url = new URL(YOUTUBE_I18N_LANGUAGES_URL);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('hl', 'en');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    return { ok: false, details: await readYouTubeApiErrorDetails(res) };
  }

  const body = (await res.json().catch(() => ({}))) as {
    items?: Array<{ id?: string; snippet?: { hl?: string; name?: string } }>;
  };

  const items = (body.items ?? [])
    .map((item) => {
      const id =
        typeof item.snippet?.hl === 'string' && item.snippet.hl.trim() !== ''
          ? item.snippet.hl.trim()
          : typeof item.id === 'string'
            ? item.id.trim()
            : '';
      const name = typeof item.snippet?.name === 'string' ? item.snippet.name.trim() : '';
      return { id, name };
    })
    .filter((item) => item.id.length > 0 && item.name.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));

  return { ok: true, items };
}

/**
 * Reads upload defaults from the authenticated user's YouTube channel and most recent upload.
 * @param accessToken - OAuth access token with YouTube read scope.
 * @param signal - Optional abort signal.
 * @returns Account defaults sourced only from YouTube Data API responses.
 */
export async function fetchYouTubeAccountDefaults(
  accessToken: string,
  signal?: AbortSignal
): Promise<{ ok: true; defaults: YouTubeAccountDefaults } | { ok: false; details: string }> {
  const authHeaders = { Authorization: `Bearer ${accessToken}` };
  const fetchInit = signal ? { headers: authHeaders, signal } : { headers: authHeaders };

  const channelUrl = new URL(YOUTUBE_CHANNELS_URL);
  channelUrl.searchParams.set('part', 'snippet,brandingSettings,status,contentDetails');
  channelUrl.searchParams.set('mine', 'true');

  const channelRes = await fetch(channelUrl.toString(), fetchInit);
  if (!channelRes.ok) {
    return { ok: false, details: await readYouTubeApiErrorDetails(channelRes) };
  }

  const channelBody = (await channelRes.json().catch(() => ({}))) as {
    items?: Array<{
      snippet?: { defaultLanguage?: string };
      brandingSettings?: { channel?: { defaultLanguage?: string } };
      status?: { madeForKids?: boolean; selfDeclaredMadeForKids?: boolean };
      contentDetails?: { relatedPlaylists?: { uploads?: string } };
    }>;
  };

  const channel = channelBody.items?.[0];
  const defaults: YouTubeAccountDefaults = {};

  const channelLanguage =
    channel?.snippet?.defaultLanguage?.trim() ||
    channel?.brandingSettings?.channel?.defaultLanguage?.trim() ||
    '';

  if (channelLanguage !== '') {
    defaults.defaultAudioLanguage = channelLanguage;
  }

  if (typeof channel?.status?.selfDeclaredMadeForKids === 'boolean') {
    defaults.madeForKids = channel.status.selfDeclaredMadeForKids;
  } else if (typeof channel?.status?.madeForKids === 'boolean') {
    defaults.madeForKids = channel.status.madeForKids;
  }

  const uploadsPlaylistId = channel?.contentDetails?.relatedPlaylists?.uploads?.trim();
  if (!uploadsPlaylistId) {
    return { ok: true, defaults };
  }

  const playlistItemsUrl = new URL(YOUTUBE_PLAYLIST_ITEMS_URL);
  playlistItemsUrl.searchParams.set('part', 'contentDetails');
  playlistItemsUrl.searchParams.set('playlistId', uploadsPlaylistId);
  playlistItemsUrl.searchParams.set('maxResults', '5');

  const playlistItemsRes = await fetch(playlistItemsUrl.toString(), fetchInit);
  if (!playlistItemsRes.ok) {
    return { ok: true, defaults };
  }

  const playlistItemsBody = (await playlistItemsRes.json().catch(() => ({}))) as {
    items?: Array<{ contentDetails?: { videoId?: string } }>;
  };

  const latestVideoIds = (playlistItemsBody.items ?? [])
    .map((item) => item.contentDetails?.videoId?.trim())
    .filter((videoId): videoId is string => Boolean(videoId));

  if (latestVideoIds.length === 0) {
    return { ok: true, defaults };
  }

  const latestVideoUrl = new URL(YOUTUBE_VIDEOS_URL);
  latestVideoUrl.searchParams.set('part', 'snippet,status');
  latestVideoUrl.searchParams.set('id', latestVideoIds.slice(0, 5).join(','));

  const latestVideoRes = await fetch(latestVideoUrl.toString(), fetchInit);
  if (!latestVideoRes.ok) {
    return { ok: true, defaults };
  }

  const latestVideoBody = (await latestVideoRes.json().catch(() => ({}))) as {
    items?: Array<{
      snippet?: {
        defaultLanguage?: string;
        defaultAudioLanguage?: string;
        categoryId?: string;
      };
      status?: {
        license?: string;
        embeddable?: boolean;
      };
    }>;
  };

  const latestVideos = latestVideoBody.items ?? [];
  const latestVideo =
    latestVideos.find((video) => video.snippet?.defaultAudioLanguage?.trim()) ??
    latestVideos.find((video) => video.snippet?.defaultLanguage?.trim()) ??
    latestVideos[0];

  const uploadAudioLanguage = latestVideo?.snippet?.defaultAudioLanguage?.trim() ?? '';
  if (uploadAudioLanguage !== '') {
    defaults.defaultAudioLanguage = uploadAudioLanguage;
  } else {
    const uploadTitleLanguage = latestVideo?.snippet?.defaultLanguage?.trim() ?? '';
    if (uploadTitleLanguage !== '') {
      defaults.defaultAudioLanguage = uploadTitleLanguage;
    }
  }

  const categoryId = latestVideo?.snippet?.categoryId?.trim() ?? '';
  if (categoryId !== '') {
    defaults.categoryId = categoryId;
  }

  const license = latestVideo?.status?.license;
  if (license === 'youtube' || license === 'creativeCommon') {
    defaults.license = license;
  }

  if (typeof latestVideo?.status?.embeddable === 'boolean') {
    defaults.embeddable = latestVideo.status.embeddable;
  }

  return { ok: true, defaults };
}
