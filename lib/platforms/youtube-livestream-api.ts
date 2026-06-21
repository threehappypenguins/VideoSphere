const YOUTUBE_LIVE_BROADCASTS_URL = 'https://www.googleapis.com/youtube/v3/liveBroadcasts';
const YOUTUBE_LIVE_STREAMS_URL = 'https://www.googleapis.com/youtube/v3/liveStreams';
const YOUTUBE_VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
const YOUTUBE_CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels';
const YOUTUBE_PLAYLIST_ITEMS_URL = 'https://www.googleapis.com/youtube/v3/playlistItems';
const YOUTUBE_THUMBNAILS_SET_URL = 'https://www.googleapis.com/upload/youtube/v3/thumbnails/set';

/** Maximum live stream resources returned by a single `liveStreams.list` page. */
const YOUTUBE_LIVE_STREAMS_LIST_MAX_RESULTS = 50;

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

function youtubeAuthHeaders(accessToken: string): { Authorization: string } {
  return { Authorization: `Bearer ${accessToken}` };
}

/**
 * Input for scheduling a YouTube live broadcast via `liveBroadcasts.insert`.
 * @property title - Broadcast title (`snippet.title`).
 * @property description - Broadcast description (`snippet.description`).
 * @property scheduledStartTime - ISO 8601 scheduled start (`snippet.scheduledStartTime`).
 * @property privacyStatus - Broadcast privacy (`status.privacyStatus`).
 * @property madeForKids - When set, maps to `status.selfDeclaredMadeForKids`.
 */
export interface ScheduleYouTubeLiveBroadcastInput {
  title: string;
  description?: string;
  scheduledStartTime: string;
  privacyStatus: 'public' | 'unlisted' | 'private';
  madeForKids?: boolean;
}

/**
 * Finds a YouTube live stream id whose ingestion stream name matches `streamKey`.
 * @param items - `liveStreams.list` response items.
 * @param streamKey - Plaintext stream key to match against `cdn.ingestionInfo.streamName`.
 * @returns Matching stream id, or null when no item matches.
 */
export function matchYouTubeLiveStreamIdByKey(
  items: Array<{ id?: string; cdn?: { ingestionInfo?: { streamName?: string } } }>,
  streamKey: string
): string | null {
  const normalizedKey = streamKey.trim();
  if (!normalizedKey) return null;

  for (const item of items) {
    const streamName = item.cdn?.ingestionInfo?.streamName?.trim();
    if (streamName === normalizedKey) {
      const id = item.id?.trim();
      if (id) return id;
    }
  }

  return null;
}

/**
 * Schedules a YouTube live broadcast with auto-start/stop and low-latency settings.
 * @param accessToken - OAuth access token with YouTube live streaming scopes.
 * @param input - Broadcast metadata and schedule time.
 * @param signal - Optional abort signal.
 * @returns New broadcast id, or upstream error details.
 */
export async function scheduleYouTubeLiveBroadcast(
  accessToken: string,
  input: ScheduleYouTubeLiveBroadcastInput,
  signal?: AbortSignal
): Promise<{ ok: true; broadcastId: string } | { ok: false; details: string }> {
  const url = new URL(YOUTUBE_LIVE_BROADCASTS_URL);
  url.searchParams.set('part', 'snippet,status,contentDetails');

  const status: {
    privacyStatus: ScheduleYouTubeLiveBroadcastInput['privacyStatus'];
    selfDeclaredMadeForKids?: boolean;
  } = {
    privacyStatus: input.privacyStatus,
  };
  if (typeof input.madeForKids === 'boolean') {
    status.selfDeclaredMadeForKids = input.madeForKids;
  }

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      ...youtubeAuthHeaders(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      snippet: {
        title: input.title,
        description: input.description ?? '',
        scheduledStartTime: input.scheduledStartTime,
      },
      status,
      contentDetails: {
        enableAutoStart: true,
        enableAutoStop: true,
        enableLowLatency: true,
        enableDvr: true,
      },
    }),
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    return { ok: false, details: await readYouTubeApiErrorDetails(res) };
  }

  const body = (await res.json().catch(() => ({}))) as { id?: string };
  const broadcastId = body.id?.trim() ?? '';
  if (!broadcastId) {
    return { ok: false, details: 'YouTube liveBroadcasts.insert did not return a broadcast id.' };
  }

  return { ok: true, broadcastId };
}

/**
 * Looks up a YouTube live stream id by matching the stream key against `liveStreams.list`.
 * @param accessToken - OAuth access token with YouTube live streaming scopes.
 * @param streamKey - Plaintext ingestion stream name to match.
 * @param signal - Optional abort signal.
 * @returns Matching live stream id, or upstream/not-found error details.
 */
export async function findYouTubeLiveStreamIdByKey(
  accessToken: string,
  streamKey: string,
  signal?: AbortSignal
): Promise<{ ok: true; streamId: string } | { ok: false; details: string }> {
  const normalizedKey = streamKey.trim();
  if (!normalizedKey) {
    return { ok: false, details: 'Stream key is required.' };
  }

  const url = new URL(YOUTUBE_LIVE_STREAMS_URL);
  url.searchParams.set('part', 'id,cdn');
  url.searchParams.set('mine', 'true');
  url.searchParams.set('fields', 'items(id,cdn/ingestionInfo/streamName)');
  url.searchParams.set('maxResults', String(YOUTUBE_LIVE_STREAMS_LIST_MAX_RESULTS));

  const res = await fetch(url.toString(), {
    headers: youtubeAuthHeaders(accessToken),
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    return { ok: false, details: await readYouTubeApiErrorDetails(res) };
  }

  const body = (await res.json().catch(() => ({}))) as {
    items?: Array<{ id?: string; cdn?: { ingestionInfo?: { streamName?: string } } }>;
  };

  // Accounts with more than 50 live stream resources would need pagination; out of scope for now.
  const streamId = matchYouTubeLiveStreamIdByKey(body.items ?? [], normalizedKey);
  if (!streamId) {
    return {
      ok: false,
      details: 'No YouTube live stream matched the provided stream key.',
    };
  }

  return { ok: true, streamId };
}

/**
 * Binds a live broadcast to a live stream via `liveBroadcasts.bind`.
 * @param accessToken - OAuth access token with YouTube live streaming scopes.
 * @param broadcastId - Live broadcast resource id.
 * @param streamId - Live stream resource id.
 * @param signal - Optional abort signal.
 * @returns Success, or upstream error details.
 */
export async function bindYouTubeBroadcastToStream(
  accessToken: string,
  broadcastId: string,
  streamId: string,
  signal?: AbortSignal
): Promise<{ ok: true } | { ok: false; details: string }> {
  const url = new URL(`${YOUTUBE_LIVE_BROADCASTS_URL}/bind`);
  url.searchParams.set('id', broadcastId);
  url.searchParams.set('streamId', streamId);
  url.searchParams.set('part', 'id,contentDetails');

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: youtubeAuthHeaders(accessToken),
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    return { ok: false, details: await readYouTubeApiErrorDetails(res) };
  }

  return { ok: true };
}

/**
 * Sets the YouTube video category on a broadcast's underlying video resource.
 * @param accessToken - OAuth access token with YouTube write scope.
 * @param videoId - Underlying video id for the live broadcast.
 * @param categoryId - YouTube category id (`snippet.categoryId`).
 * @param signal - Optional abort signal.
 * @returns Success, or upstream error details.
 */
export async function setYouTubeBroadcastCategory(
  accessToken: string,
  videoId: string,
  categoryId: string,
  signal?: AbortSignal
): Promise<{ ok: true } | { ok: false; details: string }> {
  const authHeaders = youtubeAuthHeaders(accessToken);
  const fetchInit = signal ? { headers: authHeaders, signal } : { headers: authHeaders };

  const listUrl = new URL(YOUTUBE_VIDEOS_URL);
  listUrl.searchParams.set('part', 'snippet');
  listUrl.searchParams.set('id', videoId);

  const listRes = await fetch(listUrl.toString(), fetchInit);
  if (!listRes.ok) {
    return { ok: false, details: await readYouTubeApiErrorDetails(listRes) };
  }

  const listBody = (await listRes.json().catch(() => ({}))) as {
    items?: Array<{ id?: string; snippet?: Record<string, unknown> }>;
  };
  const existing = listBody.items?.[0];
  if (!existing?.snippet) {
    return { ok: false, details: `YouTube video ${videoId} was not found.` };
  }

  const updateUrl = new URL(YOUTUBE_VIDEOS_URL);
  updateUrl.searchParams.set('part', 'snippet');

  const updateRes = await fetch(updateUrl.toString(), {
    method: 'PUT',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: videoId,
      snippet: {
        ...existing.snippet,
        categoryId,
      },
    }),
    ...(signal ? { signal } : {}),
  });

  if (!updateRes.ok) {
    return { ok: false, details: await readYouTubeApiErrorDetails(updateRes) };
  }

  return { ok: true };
}

/**
 * Sets `videos.status.publicStatsViewable` on a live broadcast's underlying video resource.
 * @param accessToken - OAuth access token with YouTube write scope.
 * @param videoId - Underlying video id for the live broadcast.
 * @param publicStatsViewable - When false, public like counts are hidden on the watch page.
 * @param signal - Optional abort signal.
 * @returns Success, or upstream error details.
 */
export async function setYouTubeVideoPublicStatsViewable(
  accessToken: string,
  videoId: string,
  publicStatsViewable: boolean,
  signal?: AbortSignal
): Promise<{ ok: true } | { ok: false; details: string }> {
  const url = new URL(YOUTUBE_VIDEOS_URL);
  url.searchParams.set('part', 'status');

  const res = await fetch(url.toString(), {
    method: 'PUT',
    headers: {
      ...youtubeAuthHeaders(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: videoId,
      status: { publicStatsViewable },
    }),
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    return { ok: false, details: await readYouTubeApiErrorDetails(res) };
  }

  return { ok: true };
}

/**
 * Uploads a custom thumbnail for a YouTube live broadcast video via `thumbnails.set`.
 * @param accessToken - OAuth access token with YouTube write scope.
 * @param videoId - Underlying video id for the live broadcast.
 * @param fileBytes - Thumbnail image bytes (JPEG or PNG).
 * @param contentType - MIME type of the thumbnail image.
 * @param signal - Optional abort signal.
 * @returns Default thumbnail URL from the API response, or upstream error details.
 */
export async function uploadYouTubeLivestreamThumbnail(
  accessToken: string,
  videoId: string,
  fileBytes: Buffer | Uint8Array,
  contentType: string,
  signal?: AbortSignal
): Promise<{ ok: true; thumbnailUrl: string } | { ok: false; details: string }> {
  const body =
    fileBytes instanceof Buffer
      ? fileBytes
      : Buffer.from(fileBytes.buffer, fileBytes.byteOffset, fileBytes.byteLength);

  const url = new URL(YOUTUBE_THUMBNAILS_SET_URL);
  url.searchParams.set('videoId', videoId);
  url.searchParams.set('uploadType', 'media');

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      ...youtubeAuthHeaders(accessToken),
      'Content-Type': contentType,
      'Content-Length': String(body.byteLength),
    },
    body,
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    return { ok: false, details: await readYouTubeApiErrorDetails(res) };
  }

  const responseBody = (await res.json().catch(() => ({}))) as {
    items?: Array<{ default?: { url?: string } }>;
  };
  const thumbnailUrl = responseBody.items?.[0]?.default?.url?.trim() ?? '';
  if (!thumbnailUrl) {
    return {
      ok: false,
      details: 'YouTube thumbnails.set succeeded but did not return a default thumbnail URL.',
    };
  }

  return { ok: true, thumbnailUrl };
}

/**
 * Reads the current lifecycle status for a live broadcast (`liveBroadcasts.list`).
 * @param accessToken - OAuth access token with YouTube read scope.
 * @param broadcastId - Live broadcast resource id.
 * @param signal - Optional abort signal.
 * @returns Raw `status.lifeCycleStatus` value, `null` when not found, or upstream error details.
 */
export async function getYouTubeBroadcastLifecycleStatus(
  accessToken: string,
  broadcastId: string,
  signal?: AbortSignal
): Promise<{ ok: true; lifeCycleStatus: string | null } | { ok: false; details: string }> {
  const url = new URL(YOUTUBE_LIVE_BROADCASTS_URL);
  url.searchParams.set('part', 'status');
  url.searchParams.set('id', broadcastId);

  const res = await fetch(url.toString(), {
    headers: youtubeAuthHeaders(accessToken),
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    return { ok: false, details: await readYouTubeApiErrorDetails(res) };
  }

  const body = (await res.json().catch(() => ({}))) as {
    items?: Array<{ status?: { lifeCycleStatus?: string } }>;
  };
  const lifeCycleStatus = body.items?.[0]?.status?.lifeCycleStatus?.trim() ?? null;

  return { ok: true, lifeCycleStatus };
}

/**
 * Ratings defaults retrievable from YouTube for livestream seeding.
 * @property showViewerLikeCount - Maps to `videos.status.publicStatsViewable` when read from YouTube.
 */
export interface YouTubeLiveCommentDefaults {
  showViewerLikeCount?: boolean;
}

function readPublicStatsViewableFromVideoStatus(
  items: Array<{ status?: { publicStatsViewable?: boolean } }> | undefined
): boolean | undefined {
  for (const item of items ?? []) {
    if (typeof item.status?.publicStatsViewable === 'boolean') {
      return item.status.publicStatsViewable;
    }
  }
  return undefined;
}

function sortBroadcastsByScheduledStartDesc(
  items: Array<{ id?: string; snippet?: { scheduledStartTime?: string } }>
): string[] {
  return [...items]
    .sort((a, b) => {
      const aTime = Date.parse(String(a.snippet?.scheduledStartTime ?? ''));
      const bTime = Date.parse(String(b.snippet?.scheduledStartTime ?? ''));
      const aMs = Number.isNaN(aTime) ? 0 : aTime;
      const bMs = Number.isNaN(bTime) ? 0 : bTime;
      return bMs - aMs;
    })
    .map((item) => item.id?.trim() ?? '')
    .filter((id) => id.length > 0);
}

/**
 * Reads the public like-count visibility default from the connected channel's recent live broadcast or latest upload.
 * Only `showViewerLikeCount` (`videos.status.publicStatsViewable`) is API-controllable today.
 * See docs/youtube-live-comments-ratings.md.
 * @param accessToken - OAuth access token with YouTube read scope.
 * @param signal - Optional abort signal.
 * @returns Defaults or upstream error details.
 */
export async function fetchYouTubeLiveCommentDefaults(
  accessToken: string,
  signal?: AbortSignal
): Promise<{ ok: true; defaults: YouTubeLiveCommentDefaults } | { ok: false; details: string }> {
  const authHeaders = youtubeAuthHeaders(accessToken);
  const fetchInit = signal ? { headers: authHeaders, signal } : { headers: authHeaders };
  const defaults: YouTubeLiveCommentDefaults = {};

  const broadcastsUrl = new URL(YOUTUBE_LIVE_BROADCASTS_URL);
  broadcastsUrl.searchParams.set('part', 'snippet');
  broadcastsUrl.searchParams.set('mine', 'true');
  broadcastsUrl.searchParams.set('maxResults', '5');
  broadcastsUrl.searchParams.set('broadcastStatus', 'all');

  const broadcastsRes = await fetch(broadcastsUrl.toString(), fetchInit);
  if (!broadcastsRes.ok) {
    return { ok: false, details: await readYouTubeApiErrorDetails(broadcastsRes) };
  }

  const broadcastsBody = (await broadcastsRes.json().catch(() => ({}))) as {
    items?: Array<{ id?: string; snippet?: { scheduledStartTime?: string } }>;
  };
  const broadcastVideoIds = sortBroadcastsByScheduledStartDesc(broadcastsBody.items ?? []);

  if (broadcastVideoIds.length > 0) {
    const videosUrl = new URL(YOUTUBE_VIDEOS_URL);
    videosUrl.searchParams.set('part', 'status');
    videosUrl.searchParams.set('id', broadcastVideoIds.slice(0, 5).join(','));

    const videosRes = await fetch(videosUrl.toString(), fetchInit);
    if (!videosRes.ok) {
      return { ok: false, details: await readYouTubeApiErrorDetails(videosRes) };
    }

    const videosBody = (await videosRes.json().catch(() => ({}))) as {
      items?: Array<{ id?: string; status?: { publicStatsViewable?: boolean } }>;
    };
    const byId = new Map(
      (videosBody.items ?? [])
        .map((item) => [item.id?.trim() ?? '', item] as const)
        .filter(([id]) => id.length > 0)
    );
    for (const videoId of broadcastVideoIds) {
      const publicStatsViewable = readPublicStatsViewableFromVideoStatus([byId.get(videoId) ?? {}]);
      if (publicStatsViewable !== undefined) {
        defaults.showViewerLikeCount = publicStatsViewable;
        return { ok: true, defaults };
      }
    }
  }

  const channelUrl = new URL(YOUTUBE_CHANNELS_URL);
  channelUrl.searchParams.set('part', 'contentDetails');
  channelUrl.searchParams.set('mine', 'true');

  const channelRes = await fetch(channelUrl.toString(), fetchInit);
  if (!channelRes.ok) {
    return { ok: false, details: await readYouTubeApiErrorDetails(channelRes) };
  }

  const channelBody = (await channelRes.json().catch(() => ({}))) as {
    items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }>;
  };
  const uploadsPlaylistId =
    channelBody.items?.[0]?.contentDetails?.relatedPlaylists?.uploads?.trim();
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

  const latestVideosUrl = new URL(YOUTUBE_VIDEOS_URL);
  latestVideosUrl.searchParams.set('part', 'status');
  latestVideosUrl.searchParams.set('id', latestVideoIds.slice(0, 5).join(','));

  const latestVideosRes = await fetch(latestVideosUrl.toString(), fetchInit);
  if (!latestVideosRes.ok) {
    return { ok: true, defaults };
  }

  const latestVideosBody = (await latestVideosRes.json().catch(() => ({}))) as {
    items?: Array<{ status?: { publicStatsViewable?: boolean } }>;
  };
  const publicStatsViewable = readPublicStatsViewableFromVideoStatus(latestVideosBody.items);
  if (publicStatsViewable !== undefined) {
    defaults.showViewerLikeCount = publicStatsViewable;
  }

  return { ok: true, defaults };
}
