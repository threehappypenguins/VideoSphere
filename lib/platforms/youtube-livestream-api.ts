import { normalizeYouTubeSnippetTags } from '@/lib/platforms/youtube';

const YOUTUBE_LIVE_BROADCASTS_URL = 'https://www.googleapis.com/youtube/v3/liveBroadcasts';
const YOUTUBE_LIVE_STREAMS_URL = 'https://www.googleapis.com/youtube/v3/liveStreams';
const YOUTUBE_VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
const YOUTUBE_THUMBNAILS_SET_URL = 'https://www.googleapis.com/upload/youtube/v3/thumbnails/set';

/** Fallback when a live video snippet has no category yet (`People & Blogs`). */
const DEFAULT_YOUTUBE_VIDEO_CATEGORY_ID = '22';

type YouTubeVideoSnippetRecord = Record<string, unknown>;

/**
 * Patch for writable `videos.snippet` fields on a live broadcast's underlying video.
 * @property categoryId - YouTube category id.
 * @property tags - Normalized tag list to store on the video.
 * @property defaultAudioLanguage - BCP-47 stream language (`snippet.defaultAudioLanguage`).
 */
export interface YouTubeBroadcastSnippetPatch {
  categoryId?: string;
  tags?: readonly string[];
  defaultAudioLanguage?: string;
}

/**
 * Result of applying snippet metadata, including tags YouTube omitted after update.
 * @property droppedTags - Tags we sent that were not returned by YouTube on read-back.
 */
export type YouTubeBroadcastSnippetUpdateResult =
  | { ok: true; droppedTags: string[] }
  | { ok: false; details: string };

async function fetchYouTubeVideoSnippet(
  accessToken: string,
  videoId: string,
  signal?: AbortSignal
): Promise<{ ok: true; snippet: YouTubeVideoSnippetRecord } | { ok: false; details: string }> {
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
    items?: Array<{ snippet?: YouTubeVideoSnippetRecord }>;
  };
  const snippet = listBody.items?.[0]?.snippet;
  if (!snippet) {
    return { ok: false, details: `YouTube video ${videoId} was not found.` };
  }

  return { ok: true, snippet };
}

/**
 * Builds the writable subset of `videos.snippet` required for `videos.update`.
 * Read-only fields from `videos.list` (thumbnails, channelId, etc.) are omitted so
 * YouTube does not reject or partially apply the update.
 * @param existing - Snippet returned by `videos.list`.
 * @param patch - Fields to set on this update.
 * @returns Writable snippet body for `videos.update`.
 */
export function buildWritableYouTubeVideoSnippet(
  existing: YouTubeVideoSnippetRecord,
  patch: YouTubeBroadcastSnippetPatch
): YouTubeVideoSnippetRecord {
  const title = typeof existing.title === 'string' ? existing.title.trim() : '';
  const categoryId =
    patch.categoryId?.trim() ||
    (typeof existing.categoryId === 'string' ? existing.categoryId.trim() : '') ||
    DEFAULT_YOUTUBE_VIDEO_CATEGORY_ID;

  const snippet: YouTubeVideoSnippetRecord = {
    title,
    categoryId,
  };

  if (typeof existing.description === 'string') {
    snippet.description = existing.description;
  }
  if (patch.defaultAudioLanguage?.trim()) {
    snippet.defaultAudioLanguage = patch.defaultAudioLanguage.trim();
  } else if (
    typeof existing.defaultAudioLanguage === 'string' &&
    existing.defaultAudioLanguage.trim() !== ''
  ) {
    snippet.defaultAudioLanguage = existing.defaultAudioLanguage.trim();
  }
  if (typeof existing.defaultLanguage === 'string' && existing.defaultLanguage.trim() !== '') {
    snippet.defaultLanguage = existing.defaultLanguage.trim();
  }

  if (patch.tags !== undefined) {
    snippet.tags = normalizeYouTubeSnippetTags(patch.tags);
  } else if (Array.isArray(existing.tags)) {
    snippet.tags = existing.tags.filter((tag): tag is string => typeof tag === 'string');
  }

  return snippet;
}

function youtubeTagsMissingAfterUpdate(
  sent: readonly string[],
  stored: readonly string[]
): string[] {
  const storedLower = new Set(stored.map((tag) => tag.trim().toLowerCase()).filter(Boolean));
  return sent.filter((tag) => !storedLower.has(tag.trim().toLowerCase()));
}

async function updateYouTubeBroadcastVideoSnippet(
  accessToken: string,
  videoId: string,
  patch: YouTubeBroadcastSnippetPatch,
  signal?: AbortSignal
): Promise<YouTubeBroadcastSnippetUpdateResult> {
  const fetched = await fetchYouTubeVideoSnippet(accessToken, videoId, signal);
  if (fetched.ok === false) {
    return fetched;
  }

  const sentTags = patch.tags !== undefined ? normalizeYouTubeSnippetTags(patch.tags) : undefined;
  const hasSnippetPatch =
    patch.categoryId?.trim() ||
    patch.defaultAudioLanguage?.trim() ||
    (sentTags !== undefined && sentTags.length > 0);
  if (!hasSnippetPatch) {
    return { ok: true, droppedTags: [] };
  }

  const authHeaders = youtubeAuthHeaders(accessToken);
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
      snippet: buildWritableYouTubeVideoSnippet(fetched.snippet, {
        ...patch,
        ...(sentTags !== undefined ? { tags: sentTags } : {}),
      }),
    }),
    ...(signal ? { signal } : {}),
  });

  if (!updateRes.ok) {
    return { ok: false, details: await readYouTubeApiErrorDetails(updateRes) };
  }

  if (!sentTags || sentTags.length === 0) {
    return { ok: true, droppedTags: [] };
  }

  const verified = await fetchYouTubeVideoSnippet(accessToken, videoId, signal);
  if (verified.ok === false) {
    return { ok: true, droppedTags: [] };
  }

  const storedTags = Array.isArray(verified.snippet.tags)
    ? verified.snippet.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];

  return { ok: true, droppedTags: youtubeTagsMissingAfterUpdate(sentTags, storedTags) };
}

/**
 * Applies category, stream language, and/or tag updates on a live broadcast video in one `videos.update` call.
 * @param accessToken - OAuth access token with YouTube write scope.
 * @param videoId - Underlying video id for the live broadcast.
 * @param patch - Snippet fields to update.
 * @param signal - Optional abort signal.
 * @returns Success with any tags YouTube omitted, or upstream error details.
 */
export async function setYouTubeBroadcastSnippetMetadata(
  accessToken: string,
  videoId: string,
  patch: YouTubeBroadcastSnippetPatch,
  signal?: AbortSignal
): Promise<YouTubeBroadcastSnippetUpdateResult> {
  const normalizedTags =
    patch.tags !== undefined ? normalizeYouTubeSnippetTags(patch.tags) : undefined;
  const hasCategory = Boolean(patch.categoryId?.trim());
  const hasTags = normalizedTags !== undefined && normalizedTags.length > 0;
  const defaultAudioLanguage = patch.defaultAudioLanguage?.trim() ?? '';

  if (!hasCategory && !hasTags && !defaultAudioLanguage) {
    return { ok: true, droppedTags: [] };
  }

  return updateYouTubeBroadcastVideoSnippet(
    accessToken,
    videoId,
    {
      ...(hasCategory ? { categoryId: patch.categoryId!.trim() } : {}),
      ...(hasTags ? { tags: normalizedTags } : {}),
      ...(defaultAudioLanguage ? { defaultAudioLanguage } : {}),
    },
    signal
  );
}

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
  const result = await setYouTubeBroadcastSnippetMetadata(
    accessToken,
    videoId,
    { categoryId },
    signal
  );
  if (result.ok === false) {
    return result;
  }
  return { ok: true };
}

/**
 * Sets `videos.snippet.tags` on a live broadcast's underlying video resource.
 * @param accessToken - OAuth access token with YouTube write scope.
 * @param videoId - Underlying video id for the live broadcast.
 * @param tags - Tag list from the livestream document.
 * @param signal - Optional abort signal.
 * @returns Success, or upstream error details.
 */
export async function setYouTubeBroadcastTags(
  accessToken: string,
  videoId: string,
  tags: readonly string[],
  signal?: AbortSignal
): Promise<{ ok: true } | { ok: false; details: string }> {
  const result = await setYouTubeBroadcastSnippetMetadata(accessToken, videoId, { tags }, signal);
  if (result.ok === false) {
    return result;
  }
  return { ok: true };
}

/**
 * Writable `videos.status` fields for a live broadcast's underlying video.
 * @property license - Standard YouTube license vs Creative Commons.
 * @property privacyStatus - Video privacy; included on update so YouTube accepts other status fields.
 * @property embeddable - When false, the video cannot be embedded on other sites.
 */
export interface YouTubeBroadcastStatusPatch {
  license?: 'youtube' | 'creativeCommon';
  privacyStatus?: 'public' | 'unlisted' | 'private';
  embeddable?: boolean;
}

type YouTubeVideoStatusRecord = Record<string, unknown>;

async function fetchYouTubeVideoStatus(
  accessToken: string,
  videoId: string,
  signal?: AbortSignal
): Promise<{ ok: true; status: YouTubeVideoStatusRecord } | { ok: false; details: string }> {
  const authHeaders = youtubeAuthHeaders(accessToken);
  const fetchInit = signal ? { headers: authHeaders, signal } : { headers: authHeaders };

  const listUrl = new URL(YOUTUBE_VIDEOS_URL);
  listUrl.searchParams.set('part', 'status');
  listUrl.searchParams.set('id', videoId);

  const listRes = await fetch(listUrl.toString(), fetchInit);
  if (!listRes.ok) {
    return { ok: false, details: await readYouTubeApiErrorDetails(listRes) };
  }

  const listBody = (await listRes.json().catch(() => ({}))) as {
    items?: Array<{ status?: YouTubeVideoStatusRecord }>;
  };
  const status = listBody.items?.[0]?.status;
  if (!status) {
    return { ok: false, details: `YouTube video ${videoId} was not found.` };
  }

  return { ok: true, status };
}

/**
 * Builds the writable subset of `videos.status` required for `videos.update`.
 * @param existing - Status returned by `videos.list`.
 * @param patch - Fields to set on this update.
 * @returns Writable status body for `videos.update`.
 */
export function buildWritableYouTubeVideoStatus(
  existing: YouTubeVideoStatusRecord,
  patch: YouTubeBroadcastStatusPatch
): YouTubeVideoStatusRecord {
  const status: YouTubeVideoStatusRecord = {};

  const privacyStatus =
    patch.privacyStatus ??
    (existing.privacyStatus === 'public' ||
    existing.privacyStatus === 'unlisted' ||
    existing.privacyStatus === 'private'
      ? existing.privacyStatus
      : undefined);
  if (privacyStatus) {
    status.privacyStatus = privacyStatus;
  }

  if (patch.license === 'youtube' || patch.license === 'creativeCommon') {
    status.license = patch.license;
  } else if (existing.license === 'youtube' || existing.license === 'creativeCommon') {
    status.license = existing.license;
  }

  if (typeof patch.embeddable === 'boolean') {
    status.embeddable = patch.embeddable;
  } else if (typeof existing.embeddable === 'boolean') {
    status.embeddable = existing.embeddable;
  }

  if (typeof existing.publicStatsViewable === 'boolean') {
    status.publicStatsViewable = existing.publicStatsViewable;
  }

  return status;
}

/**
 * Updates writable `videos.status` fields on a live broadcast's underlying video resource.
 * @param accessToken - OAuth access token with YouTube write scope.
 * @param videoId - Underlying video id for the live broadcast.
 * @param patch - Status fields to update.
 * @param signal - Optional abort signal.
 * @returns Success, or upstream error details.
 */
export async function setYouTubeBroadcastVideoStatus(
  accessToken: string,
  videoId: string,
  patch: YouTubeBroadcastStatusPatch,
  signal?: AbortSignal
): Promise<{ ok: true } | { ok: false; details: string }> {
  const hasPatch =
    patch.license === 'youtube' ||
    patch.license === 'creativeCommon' ||
    typeof patch.embeddable === 'boolean' ||
    patch.privacyStatus === 'public' ||
    patch.privacyStatus === 'unlisted' ||
    patch.privacyStatus === 'private';

  if (!hasPatch) {
    return { ok: true };
  }

  const fetched = await fetchYouTubeVideoStatus(accessToken, videoId, signal);
  if (fetched.ok === false) {
    return fetched;
  }

  const status = buildWritableYouTubeVideoStatus(fetched.status, patch);
  if (Object.keys(status).length === 0) {
    return { ok: true };
  }

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
      status,
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
