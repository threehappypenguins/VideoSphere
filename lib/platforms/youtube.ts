import type { PlatformUploadVisibility } from '@/types';
import {
  isAllowedDraftThumbnailContentType,
  MAX_DRAFT_THUMBNAIL_BYTES,
} from '@/lib/draft-thumbnail';
import { getObjectWebStream } from '@/lib/r2';
import { messageFromThrown } from '@/lib/utils/error-message';
import type {
  PlatformUploadError,
  PlatformUploadMetadata,
  PlatformUploadResult,
  PlatformUploadTokens,
} from '@/lib/platforms/types';

type PlatformUploadFailure = Extract<PlatformUploadResult, { ok: false }>;

interface UploadToYouTubeInput {
  videoStream: ReadableStream<Uint8Array>;
  contentLength?: number;
  contentType?: string;
  metadata: PlatformUploadMetadata;
  tokens: PlatformUploadTokens;
  /** When set (e.g. distribute deadline), aborts R2-backed fetches so timeouts stop real work. */
  signal?: AbortSignal;
}

interface GoogleRefreshTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
}

const YOUTUBE_RESUMABLE_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos' +
  '?uploadType=resumable' +
  '&part=snippet,status,recordingDetails';

/**
 * Builds the resumable `videos.insert` init URL, optionally disabling subscriber notifications.
 * @param notifySubscribers - When false, adds `notifySubscribers=false` (YouTube default is true).
 * @returns Resumable upload initialization URL.
 */
export function buildYouTubeResumableInitUrl(notifySubscribers: boolean): string {
  if (notifySubscribers) {
    return YOUTUBE_RESUMABLE_URL;
  }
  return `${YOUTUBE_RESUMABLE_URL}&notifySubscribers=false`;
}
const YOUTUBE_THUMBNAILS_SET_URL = 'https://www.googleapis.com/upload/youtube/v3/thumbnails/set';
const YOUTUBE_PLAYLISTS_URL = 'https://www.googleapis.com/youtube/v3/playlists';

const MAX_CUSTOM_THUMBNAIL_BYTES = MAX_DRAFT_THUMBNAIL_BYTES;
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_YOUTUBE_CATEGORY_ID = '22';

/**
 * YouTube `snippet.tags` total character budget (videos resource).
 * Commas between tags count; tags containing spaces are counted as though wrapped in quotes (+2).
 *
 * @see https://developers.google.com/youtube/v3/docs/videos#resource
 */
const YOUTUBE_SNIPPET_TAGS_MAX_CHARS = 500;

/**
 * Approximate serialized length of `snippet.tags` per YouTube counting rules (for trimming).
 */
export function estimateYouTubeTagsListCharCount(tags: string[]): number {
  if (tags.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    n += t.length + (/\s/.test(t) ? 2 : 0);
    if (i < tags.length - 1) n += 1;
  }
  return n;
}

function clipTagToMaxYouTubeTagChars(tag: string, maxContentChars: number): string {
  if (maxContentChars <= 0) return '';
  return tag.length <= maxContentChars ? tag : tag.slice(0, maxContentChars);
}

/**
 * Trim tags, drop empties, and fit the list under YouTube’s `snippet.tags` character limit.
 * Order is preserved; oversized tails are dropped or truncated so the API does not reject the upload.
 */
export function normalizeYouTubeSnippetTags(raw: readonly string[]): string[] {
  const trimmed = raw.map((t) => t.trim()).filter((t) => t.length > 0);
  const out: string[] = [];

  for (const tag of trimmed) {
    const withWhole = [...out, tag];
    if (estimateYouTubeTagsListCharCount(withWhole) <= YOUTUBE_SNIPPET_TAGS_MAX_CHARS) {
      out.push(tag);
      continue;
    }

    const used = estimateYouTubeTagsListCharCount(out);
    const comma = out.length > 0 ? 1 : 0;
    const remaining = YOUTUBE_SNIPPET_TAGS_MAX_CHARS - used - comma;
    if (remaining <= 0) break;

    const quoteAllowance = /\s/.test(tag) ? 2 : 0;
    const maxContent = remaining - quoteAllowance;
    const clipped = clipTagToMaxYouTubeTagChars(tag, maxContent);
    if (clipped.length > 0) {
      out.push(clipped);
    }
    break;
  }

  return out;
}

function youtubePlaylistTitleKey(title: string): string {
  return title.trim().toLowerCase();
}

/** Preserve first occurrence per case-insensitive title. */
export function uniqueTrimmedPlaylistTitles(titles: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of titles) {
    const t = raw.trim();
    if (!t) continue;
    const key = youtubePlaylistTitleKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function uniqueTrimmedPlaylistIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Fetches one page of the authenticated user's YouTube playlists (`playlists.list`).
 * @param accessToken - OAuth access token with YouTube read scope.
 * @param pageToken - Optional pagination token from a prior response.
 * @param signal - Optional abort signal.
 * @returns Playlist id/title rows for the page, or a structured failure.
 */
export async function youtubeFetchPlaylistsPage(
  accessToken: string,
  pageToken?: string,
  signal?: AbortSignal
): Promise<
  | {
      ok: true;
      items: Array<{ id: string; title: string }>;
      nextPageToken?: string;
    }
  | PlatformUploadFailure
> {
  const u = new URL(YOUTUBE_PLAYLISTS_URL);
  u.searchParams.set('part', 'snippet');
  u.searchParams.set('mine', 'true');
  u.searchParams.set('maxResults', '50');
  if (pageToken) u.searchParams.set('pageToken', pageToken);

  const res = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) {
    const details = await readApiErrorDetails(res);
    return toError(
      'YOUTUBE_PLAYLIST_LIST_FAILED',
      'Failed to list YouTube playlists (playlists.list).',
      res.status,
      details
    );
  }
  const body = (await res.json().catch(() => ({}))) as {
    items?: Array<{ id?: string; snippet?: { title?: string } }>;
    nextPageToken?: string;
  };
  const items = (body.items ?? [])
    .map((it) => ({
      id: typeof it.id === 'string' ? it.id : '',
      title: typeof it.snippet?.title === 'string' ? it.snippet.title : '',
    }))
    .filter((it) => it.id.length > 0);
  return { ok: true, items, nextPageToken: body.nextPageToken };
}

/**
 * Paginates through all of the authenticated user's YouTube playlists.
 * @param accessToken - OAuth access token with YouTube read scope.
 * @param signal - Optional abort signal.
 * @returns Full playlist id/title list, or a structured failure from any page.
 */
export async function fetchAllYouTubePlaylists(
  accessToken: string,
  signal?: AbortSignal
): Promise<{ ok: true; items: Array<{ id: string; title: string }> } | PlatformUploadFailure> {
  const items: Array<{ id: string; title: string }> = [];
  let pageToken: string | undefined;

  for (;;) {
    const page = await youtubeFetchPlaylistsPage(accessToken, pageToken, signal);
    if (page.ok === false) return page;
    items.push(...page.items);
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }

  return { ok: true, items };
}

async function findYouTubePlaylistIdByTitle(
  accessToken: string,
  wantedTitle: string,
  signal?: AbortSignal
): Promise<{ ok: true; id: string } | { ok: true; notFound: true } | PlatformUploadFailure> {
  const key = youtubePlaylistTitleKey(wantedTitle);
  if (!key) return { ok: true, notFound: true };

  let pageToken: string | undefined;
  for (;;) {
    const page = await youtubeFetchPlaylistsPage(accessToken, pageToken, signal);
    if (page.ok === false) return page;
    for (const it of page.items) {
      if (youtubePlaylistTitleKey(it.title) === key) {
        return { ok: true, id: it.id };
      }
    }
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }
  return { ok: true, notFound: true };
}

async function createYouTubePlaylist(
  accessToken: string,
  title: string,
  privacyStatus: 'public' | 'unlisted' | 'private',
  signal?: AbortSignal
): Promise<{ ok: true; id: string } | PlatformUploadFailure> {
  const safeTitle = title.trim() || 'Untitled playlist';
  const url = `${YOUTUBE_PLAYLISTS_URL}?part=snippet,status`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      snippet: { title: safeTitle },
      status: { privacyStatus },
    }),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) {
    let details = await readApiErrorDetails(res);
    if (res.status === 403 && details?.toLowerCase().includes('insufficient')) {
      details = `${details} Disconnect and reconnect YouTube under Profile → Connections so the saved token includes the https://www.googleapis.com/auth/youtube scope (required for playlists.insert alongside upload).`;
    }
    return toError(
      'YOUTUBE_PLAYLIST_CREATE_FAILED',
      `Failed to create YouTube playlist (playlists.insert): "${safeTitle}".`,
      res.status,
      details
    );
  }
  const body = (await res.json().catch(() => ({}))) as { id?: string };
  if (!body.id) {
    return toError(
      'YOUTUBE_PLAYLIST_ID_MISSING',
      'YouTube playlists.insert succeeded but did not return a playlist id.'
    );
  }
  return { ok: true, id: body.id };
}

async function resolveYouTubePlaylistNameToId(
  accessToken: string,
  displayTitle: string,
  privacyStatus: 'public' | 'unlisted' | 'private',
  signal?: AbortSignal
): Promise<{ ok: true; id: string } | PlatformUploadFailure> {
  const trimmed = displayTitle.trim();
  if (!trimmed) {
    return toError('YOUTUBE_PLAYLIST_NAME_EMPTY', 'Playlist name was empty after trimming.');
  }

  const found = await findYouTubePlaylistIdByTitle(accessToken, trimmed, signal);
  if (found.ok === false) return found;
  if ('notFound' in found) {
    return createYouTubePlaylist(accessToken, trimmed, privacyStatus, signal);
  }
  return { ok: true, id: found.id };
}

function visibilityToYouTubePrivacy(
  visibility: PlatformUploadVisibility
): 'public' | 'unlisted' | 'private' {
  if (visibility === 'private') return 'private';
  if (visibility === 'unlisted') return 'unlisted';
  return 'public';
}

function toError(
  code: string,
  message: string,
  statusCode?: number,
  details?: string
): PlatformUploadFailure {
  return {
    ok: false,
    error: {
      code,
      message,
      statusCode,
      details,
    },
  };
}

async function readApiErrorDetails(response: Response): Promise<string | undefined> {
  const raw = await response.text().catch(() => '');
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string; errors?: Array<{ reason?: string; message?: string }> };
    };
    const topMessage = parsed.error?.message?.trim();
    const firstError = parsed.error?.errors?.[0];
    const reason = firstError?.reason?.trim();
    const reasonMessage = firstError?.message?.trim();

    if (reason && reasonMessage) return `${reason}: ${reasonMessage}`;
    if (reasonMessage) return reasonMessage;
    if (topMessage) return topMessage;
  } catch {
    // non-JSON response body; fall back to text
  }

  return raw.slice(0, 1000);
}

/** Google requires each chunk (except the last) to be a multiple of 256 KiB. */
const YOUTUBE_CHUNK_MULTIPLE = 256 * 1024;
const YOUTUBE_CHUNK_TARGET = 8 * 1024 * 1024;

/**
 * Executes next YouTube chunk size.
 * @param remaining - Input value for remaining.
 * @returns The computed result.
 */
export function nextYouTubeChunkSize(remaining: number): number {
  if (remaining <= 0) return 0;
  if (remaining < YOUTUBE_CHUNK_MULTIPLE) return remaining;
  const capped = Math.min(YOUTUBE_CHUNK_TARGET, remaining);
  const aligned = Math.floor(capped / YOUTUBE_CHUNK_MULTIPLE) * YOUTUBE_CHUNK_MULTIPLE;
  return aligned >= YOUTUBE_CHUNK_MULTIPLE ? aligned : remaining;
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

async function readExactFromStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  carry: Uint8Array,
  need: number
): Promise<{ data: Uint8Array; carry: Uint8Array }> {
  if (need === 0) return { data: new Uint8Array(0), carry };
  const chunks: Uint8Array[] = [];
  let buf = carry;

  while (need > 0) {
    if (buf.length > 0) {
      const take = Math.min(buf.length, need);
      chunks.push(buf.subarray(0, take));
      buf = buf.subarray(take);
      need -= take;
      continue;
    }
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.length > 0) {
      buf = value;
    }
  }

  if (need > 0) {
    throw new Error(`Video stream ended ${need} byte(s) earlier than Content-Length.`);
  }
  return { data: concatUint8Arrays(chunks), carry: buf };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse the `Range` header on a 308 Resume Incomplete from YouTube/Google resumable upload.
 * Value is cumulative bytes stored (e.g. `bytes 0-524287` or `bytes=0-524287`).
 * Returns the last byte index received (inclusive), or `null` if missing/invalid.
 *
 * @see https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
 */
export function parseYouTube308RangeLastByteInclusive(headerValue: string | null): number | null {
  if (headerValue == null || headerValue.trim() === '') return null;
  const s = headerValue.trim();
  if (s.includes('*')) return null;
  const m = /^bytes[\t ]*[= ][\t ]*(\d+)[\t ]*-[ \t]*(\d+)\s*$/i.exec(s);
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return null;
  return end;
}

/**
 * Resumable upload in 256 KiB–aligned chunks (Google's recommended protocol).
 * Avoids long single-PUT streams that often end in HTTP 408 from Google frontends.
 */
async function uploadYouTubeResumableInChunks(input: {
  sessionUrl: string;
  accessToken: string;
  stream: ReadableStream<Uint8Array>;
  totalBytes: number;
  contentType: string;
  signal?: AbortSignal;
}): Promise<PlatformUploadResult> {
  const reader = input.stream.getReader();
  let carry: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  let offset = 0;
  const { sessionUrl, accessToken, contentType, totalBytes: total, signal } = input;

  try {
    while (offset < total) {
      if (signal?.aborted) {
        const reason = signal.reason;
        return toError(
          'YOUTUBE_UPLOAD_ABORTED',
          reason instanceof Error ? reason.message : 'YouTube upload was aborted.',
          499
        );
      }
      const remaining = total - offset;
      const chunkSize = nextYouTubeChunkSize(remaining);
      let chunk: Uint8Array<ArrayBufferLike>;
      try {
        const r = await readExactFromStream(reader, carry, chunkSize);
        chunk = r.data;
        carry = r.carry;
      } catch (e) {
        return toError(
          'YOUTUBE_UPLOAD_STREAM_READ_FAILED',
          e instanceof Error ? e.message : 'Failed to read video stream for upload.',
          500
        );
      }

      if (chunk.length === 0) {
        return toError(
          'YOUTUBE_UPLOAD_EMPTY_CHUNK',
          'Received an empty chunk while uploading to YouTube.',
          400
        );
      }

      const lastByte = offset + chunk.length - 1;
      const contentRange = `bytes ${offset}-${lastByte}/${total}`;

      let res: Response | null = null;
      for (let attempt = 1; attempt <= 4; attempt++) {
        res = await fetch(sessionUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': contentType,
            'Content-Length': String(chunk.length),
            'Content-Range': contentRange,
          },
          body: chunk as BodyInit,
          ...(signal ? { signal } : {}),
        });

        if (res.status === 408 || (res.status >= 500 && res.status < 600)) {
          if (attempt < 4) {
            await sleep(2 ** (attempt - 1) * 1000);
            continue;
          }
        }
        break;
      }

      if (!res) {
        return toError('YOUTUBE_UPLOAD_FAILED', 'YouTube upload returned no response.', 500);
      }

      if (res.status === 200 || res.status === 201) {
        const raw = await res.text().catch(() => '');
        let uploadPayload: { id?: string } = {};
        if (raw) {
          try {
            uploadPayload = JSON.parse(raw) as { id?: string };
          } catch {
            /* ignore */
          }
        }
        const videoId = uploadPayload.id;
        if (!videoId) {
          return toError(
            'YOUTUBE_VIDEO_ID_MISSING',
            'YouTube upload succeeded but no video ID was returned.'
          );
        }
        return {
          ok: true,
          platformVideoId: videoId,
          platformUrl: `https://www.youtube.com/watch?v=${videoId}`,
        };
      }

      if (res.status === 308) {
        const chunkStart = offset;
        const lastReceived = parseYouTube308RangeLastByteInclusive(res.headers.get('Range'));
        let nextAbsolute: number;
        if (lastReceived === null) {
          nextAbsolute = chunkStart + chunk.length;
        } else {
          nextAbsolute = lastReceived + 1;
          if (nextAbsolute < chunkStart) {
            return toError(
              'YOUTUBE_UPLOAD_RANGE_INVALID',
              'YouTube Range header is behind the current upload offset.',
              502
            );
          }
          if (nextAbsolute > chunkStart + chunk.length) {
            nextAbsolute = chunkStart + chunk.length;
          }
        }

        if (nextAbsolute > total) {
          return toError(
            'YOUTUBE_UPLOAD_RANGE_MISMATCH',
            'YouTube upload advanced past declared file size.',
            502
          );
        }

        if (nextAbsolute < chunkStart + chunk.length) {
          const remainder = chunk.subarray(nextAbsolute - chunkStart);
          carry = concatUint8Arrays([remainder, carry]);
        }

        offset = nextAbsolute;
        continue;
      }

      const details = await readApiErrorDetails(res);
      return toError('YOUTUBE_UPLOAD_FAILED', 'YouTube video upload failed.', res.status, details);
    }

    return toError(
      'YOUTUBE_UPLOAD_INCOMPLETE',
      'YouTube resumable upload ended before the full file was sent.',
      500
    );
  } finally {
    reader.releaseLock();
  }
}

async function uploadYouTubeResumableSinglePut(input: {
  sessionUrl: string;
  accessToken: string;
  stream: ReadableStream<Uint8Array>;
  contentLength?: number;
  contentType: string;
  signal?: AbortSignal;
}): Promise<PlatformUploadResult> {
  const uploadRequestInit: RequestInit & { duplex: 'half' } = {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': input.contentType,
      ...(input.contentLength !== undefined
        ? { 'Content-Length': String(input.contentLength) }
        : {}),
    },
    body: input.stream,
    duplex: 'half',
    ...(input.signal ? { signal: input.signal } : {}),
  };

  const uploadResponse = await fetch(input.sessionUrl, uploadRequestInit);

  if (!uploadResponse.ok) {
    const details = await readApiErrorDetails(uploadResponse);
    return toError(
      'YOUTUBE_UPLOAD_FAILED',
      'YouTube video upload failed.',
      uploadResponse.status,
      details
    );
  }

  const uploadPayload = (await uploadResponse.json().catch(() => ({}))) as { id?: string };
  const videoId = uploadPayload.id;

  if (!videoId) {
    return toError(
      'YOUTUBE_VIDEO_ID_MISSING',
      'YouTube upload succeeded but no video ID was returned.'
    );
  }

  return {
    ok: true,
    platformVideoId: videoId,
    platformUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

/**
 * Executes refresh YouTube access token.
 * @param input - Input payload for this operation.
 * @returns The computed result.
 */
export async function refreshYouTubeAccessToken(input: {
  refreshToken?: string;
}): Promise<
  | { ok: true; accessToken: string; refreshToken: string; tokenExpiry: string }
  | { ok: false; error: PlatformUploadError }
> {
  if (!input.refreshToken) {
    return {
      ok: false,
      error: {
        code: 'YOUTUBE_REFRESH_TOKEN_MISSING',
        message: 'YouTube refresh token is missing.',
      },
    };
  }

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return {
      ok: false,
      error: {
        code: 'YOUTUBE_OAUTH_CONFIG_MISSING',
        message: 'YouTube OAuth client configuration is missing on the server.',
      },
    };
  }

  try {
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: input.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const details = await readApiErrorDetails(tokenResponse);
      return {
        ok: false,
        error: {
          code: 'YOUTUBE_TOKEN_REFRESH_FAILED',
          message: 'Failed to refresh YouTube access token.',
          statusCode: tokenResponse.status,
          details,
        },
      };
    }

    const payload = (await tokenResponse.json().catch(() => ({}))) as GoogleRefreshTokenResponse;
    if (!payload.access_token || !payload.expires_in) {
      return {
        ok: false,
        error: {
          code: 'YOUTUBE_TOKEN_REFRESH_INVALID_RESPONSE',
          message: 'YouTube token refresh response is missing required fields.',
        },
      };
    }

    return {
      ok: true,
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? input.refreshToken,
      tokenExpiry: new Date(Date.now() + payload.expires_in * 1000).toISOString(),
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'YOUTUBE_TOKEN_REFRESH_ERROR',
        message: 'Unexpected error while refreshing YouTube access token.',
        statusCode: 500,
        details: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Executes upload to YouTube.
 * @param input - Input payload for this operation.
 * @returns The computed result.
 */
export async function uploadToYouTube(input: UploadToYouTubeInput): Promise<PlatformUploadResult> {
  if (!input.tokens.accessToken) {
    return toError('YOUTUBE_TOKEN_MISSING', 'YouTube access token is missing.');
  }

  const { signal } = input;

  try {
    const videoSource = {
      stream: input.videoStream,
      contentLength: input.contentLength,
      contentType: input.contentType ?? 'application/octet-stream',
    };

    const safeTitle = input.metadata.title.trim() || 'Untitled video';
    const safeDescription = input.metadata.description.trim();
    const safeTags = normalizeYouTubeSnippetTags(input.metadata.tags);

    const m = input.metadata;
    const snippet: Record<string, unknown> = {
      title: safeTitle,
      description: safeDescription,
      tags: safeTags,
      categoryId: m.categoryId?.trim() || DEFAULT_YOUTUBE_CATEGORY_ID,
    };
    if (m.defaultLanguage?.trim()) snippet.defaultLanguage = m.defaultLanguage.trim();
    if (m.defaultAudioLanguage?.trim())
      snippet.defaultAudioLanguage = m.defaultAudioLanguage.trim();

    const status: Record<string, unknown> = {
      privacyStatus: visibilityToYouTubePrivacy(m.visibility),
    };
    if (m.madeForKids !== undefined) status.selfDeclaredMadeForKids = m.madeForKids;
    if (m.embeddable !== undefined) status.embeddable = m.embeddable;
    if (m.license !== undefined) status.license = m.license;
    if (m.publishAt?.trim()) {
      status.publishAt = m.publishAt.trim();
      // YouTube Data API: publishAt may only be set when privacyStatus is private
      // (scheduled publish from private; see video resource status.publishAt).
      status.privacyStatus = 'private';
    }
    const recordingDetails: Record<string, unknown> = {};
    if (m.recordingDate?.trim()) recordingDetails.recordingDate = m.recordingDate.trim();

    const initUrl = buildYouTubeResumableInitUrl(m.notifySubscribers !== false);
    const initBody = {
      snippet,
      status,
      ...(Object.keys(recordingDetails).length > 0 && { recordingDetails }),
    };

    if (process.env.NODE_ENV !== 'production') {
      console.log(
        '[youtube] Resumable upload init request',
        JSON.stringify({
          initUrl,
          body: initBody,
        })
      );
    }

    const initResponse = await fetch(initUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.tokens.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': videoSource.contentType,
        ...(videoSource.contentLength
          ? { 'X-Upload-Content-Length': String(videoSource.contentLength) }
          : {}),
      },
      body: JSON.stringify(initBody),
      ...(signal ? { signal } : {}),
    });

    if (!initResponse.ok) {
      const details = await readApiErrorDetails(initResponse);
      return toError(
        'YOUTUBE_RESUMABLE_INIT_FAILED',
        'Failed to initiate YouTube resumable upload.',
        initResponse.status,
        details
      );
    }

    const resumableUploadUrl = initResponse.headers.get('location');
    if (!resumableUploadUrl) {
      return toError('YOUTUBE_RESUMABLE_URL_MISSING', 'YouTube upload URL was not returned.');
    }

    const uploadResult =
      videoSource.contentLength && videoSource.contentLength > 0
        ? await uploadYouTubeResumableInChunks({
            sessionUrl: resumableUploadUrl,
            accessToken: input.tokens.accessToken,
            stream: videoSource.stream,
            totalBytes: videoSource.contentLength,
            contentType: videoSource.contentType,
            signal,
          })
        : await uploadYouTubeResumableSinglePut({
            sessionUrl: resumableUploadUrl,
            accessToken: input.tokens.accessToken,
            stream: videoSource.stream,
            contentLength: videoSource.contentLength,
            contentType: videoSource.contentType,
            signal,
          });

    if (!uploadResult.ok) {
      return uploadResult;
    }

    const videoId = uploadResult.platformVideoId;

    const videoPrivacy = visibilityToYouTubePrivacy(m.visibility);
    const explicitIds = uniqueTrimmedPlaylistIds(m.playlistIds ?? []);
    const nameList = uniqueTrimmedPlaylistTitles(m.playlistTitles ?? []);
    const playlistTargets: string[] = [...explicitIds];
    for (const name of nameList) {
      const resolved = await resolveYouTubePlaylistNameToId(
        input.tokens.accessToken,
        name,
        videoPrivacy,
        signal
      );
      if (resolved.ok === false) {
        return resolved;
      }
      playlistTargets.push(resolved.id);
    }
    const uniquePlaylistIds = uniqueTrimmedPlaylistIds(playlistTargets);

    for (const playlistId of uniquePlaylistIds) {
      const plRes = await fetch(
        'https://www.googleapis.com/youtube/v3/playlistItems?part=snippet',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${input.tokens.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            snippet: {
              playlistId,
              resourceId: { kind: 'youtube#video', videoId },
            },
          }),
          ...(signal ? { signal } : {}),
        }
      );
      if (!plRes.ok) {
        const details = await readApiErrorDetails(plRes);
        return toError(
          'YOUTUBE_PLAYLIST_ITEM_FAILED',
          `Video uploaded but adding it to playlist "${playlistId}" failed.`,
          plRes.status,
          details
        );
      }
    }

    const thumbKey = m.thumbnailR2Key?.trim();
    if (thumbKey) {
      // Pre-validate an explicitly provided content type; a missing/empty field is resolved against
      // the R2 object's content-type header after the stream is opened (so a PNG stored without
      // draft metadata is not incorrectly declared as JPEG to YouTube).
      const draftCt = m.thumbnailContentType?.trim().toLowerCase();
      if (draftCt && !isAllowedDraftThumbnailContentType(draftCt)) {
        return toError(
          'YOUTUBE_THUMBNAIL_FORMAT',
          'YouTube custom thumbnails must be JPEG or PNG.',
          400
        );
      }
      let thumbStream: ReadableStream<Uint8Array>;
      let thumbLen: number;
      let thumbR2Ct: string;
      try {
        const opened = await getObjectWebStream(thumbKey, { signal });
        thumbStream = opened.stream;
        thumbLen = opened.contentLength;
        thumbR2Ct = opened.contentType?.trim().toLowerCase() ?? '';
      } catch (err) {
        return toError(
          'YOUTUBE_THUMBNAIL_R2_FAILED',
          'Could not read thumbnail from storage for YouTube.',
          500,
          messageFromThrown(err)
        );
      }
      // Prefer validated draft CT, fall back to R2 CT, last resort jpeg (matching Vimeo pattern).
      const rawCt =
        (draftCt && isAllowedDraftThumbnailContentType(draftCt) ? draftCt : null) ??
        (isAllowedDraftThumbnailContentType(thumbR2Ct) ? thumbR2Ct : 'image/jpeg');
      if (thumbLen > MAX_CUSTOM_THUMBNAIL_BYTES) {
        await thumbStream.cancel().catch(() => undefined);
        return toError(
          'YOUTUBE_THUMBNAIL_TOO_LARGE',
          'Thumbnail exceeds the maximum size allowed for upload.',
          400
        );
      }
      const thumbBody = await new Response(thumbStream).arrayBuffer();
      const thumbRes = await fetch(
        `${YOUTUBE_THUMBNAILS_SET_URL}?videoId=${encodeURIComponent(videoId)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${input.tokens.accessToken}`,
            'Content-Type': rawCt,
            'Content-Length': String(thumbBody.byteLength),
          },
          body: thumbBody,
          ...(signal ? { signal } : {}),
        }
      );
      if (!thumbRes.ok) {
        const details = await readApiErrorDetails(thumbRes);
        return toError(
          'YOUTUBE_THUMBNAIL_SET_FAILED',
          'Video uploaded but setting the custom thumbnail on YouTube failed.',
          thumbRes.status,
          details
        );
      }
    }

    return {
      ok: true,
      platformVideoId: videoId,
      platformUrl: `https://www.youtube.com/watch?v=${videoId}`,
    };
  } catch (error) {
    return toError(
      'YOUTUBE_UPLOAD_ERROR',
      'Unexpected YouTube upload error.',
      500,
      messageFromThrown(error)
    );
  }
}
