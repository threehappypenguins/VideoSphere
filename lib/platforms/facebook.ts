import type { ConnectedAccount } from '@/types';
import {
  isAllowedDraftThumbnailContentType,
  MAX_DRAFT_THUMBNAIL_BYTES,
} from '@/lib/draft-thumbnail';
import { FACEBOOK_GRAPH_API_BASE, facebookGraphApiFetchInit } from '@/lib/platforms/facebook-oauth';
import { validateFacebookScheduledPublishTime } from '@/lib/platforms/facebook-schedule';
import { getObjectWebStream } from '@/lib/r2';
import { messageFromThrown } from '@/lib/utils/error-message';
import type {
  PlatformUploadMetadata,
  PlatformUploadResult,
  PlatformUploadTokens,
} from '@/lib/platforms/types';

export {
  FACEBOOK_MAX_SCHEDULE_LEAD_SECONDS,
  FACEBOOK_MIN_SCHEDULE_LEAD_SECONDS,
  validateFacebookScheduledPublishTime,
} from '@/lib/platforms/facebook-schedule';

const FACEBOOK_RUPLOAD_BASE = 'https://rupload.facebook.com/video-upload/v25.0';
const FACEBOOK_RUPLOAD_HOSTNAME = 'rupload.facebook.com';
const FACEBOOK_RUPLOAD_PATH_PREFIX = '/video-upload/v25.0';

/**
 * Returns true when a URL is a trusted Reels binary upload destination for the given video.
 * @param resolved - Parsed upload URL from the START response.
 * @param videoId - Video ID from the START response.
 * @returns True when the URL targets the expected rupload path for this video.
 */
function isTrustedFacebookReelsUploadUrl(resolved: URL, videoId: string): boolean {
  if (
    resolved.protocol !== 'https:' ||
    resolved.hostname !== FACEBOOK_RUPLOAD_HOSTNAME ||
    resolved.username !== '' ||
    resolved.password !== '' ||
    (resolved.port !== '' && resolved.port !== '443')
  ) {
    return false;
  }

  const normalizedPath = resolved.pathname.replace(/\/+$/, '') || '/';
  return normalizedPath === `${FACEBOOK_RUPLOAD_PATH_PREFIX}/${videoId}`;
}

/**
 * Resolves the Reels binary upload URL from the START response.
 * Prefers Meta's `upload_url` when it points at the official rupload host and path.
 * @param videoId - Video ID from the START response.
 * @param uploadUrl - Optional upload URL returned by Meta on START.
 * @returns HTTPS upload destination for the rupload POST.
 */
function resolveFacebookReelsUploadUrl(videoId: string, uploadUrl?: string): string {
  const trimmedVideoId = videoId.trim();
  const trimmed = uploadUrl?.trim() ?? '';
  if (trimmed !== '' && trimmedVideoId !== '') {
    try {
      const resolved = new URL(trimmed);
      if (isTrustedFacebookReelsUploadUrl(resolved, trimmedVideoId)) {
        resolved.port = '';
        return resolved.toString();
      }
    } catch {
      // fall through to constructed default
    }
  }
  return `${FACEBOOK_RUPLOAD_BASE}/${trimmedVideoId}`;
}

/**
 * Resolves MIME type for Facebook thumbnail upload.
 * Prefers draft metadata when valid, then R2 `contentType`, then `image/jpeg`.
 * @param metadataCt - Draft `thumbnailContentType` from distribute metadata.
 * @param r2ContentType - Content-Type reported by R2 for the thumbnail object.
 * @returns Allowed image/jpeg or image/png for the thumbnail Blob.
 */
function facebookThumbnailContentType(
  metadataCt: string | undefined,
  r2ContentType: string
): string {
  const meta = metadataCt?.trim().toLowerCase();
  if (meta && isAllowedDraftThumbnailContentType(meta)) {
    return meta;
  }
  const fromR2 = r2ContentType.trim().toLowerCase();
  if (isAllowedDraftThumbnailContentType(fromR2)) {
    return fromR2;
  }
  return 'image/jpeg';
}

interface UploadToFacebookInput {
  connectedAccount: ConnectedAccount;
  videoStream: ReadableStream<Uint8Array>;
  contentLength?: number;
  contentType?: string;
  metadata: PlatformUploadMetadata;
  tokens: PlatformUploadTokens;
  /** When set (e.g. distribute deadline), aborts R2-backed fetches and upload fetches. */
  signal?: AbortSignal;
}

interface FacebookReelsStartResponse {
  video_id?: string;
  upload_url?: string;
  error?: { message?: string; code?: number };
}

interface FacebookReelsFinishResponse {
  success?: boolean;
  post_id?: string;
  error?: { message?: string; code?: number };
}

function toError(
  code: string,
  message: string,
  statusCode?: number,
  details?: string
): PlatformUploadResult {
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

async function readSmallStreamToArrayBuffer(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Aborted');
  }
  return new Response(stream).arrayBuffer();
}

/**
 * Resolves the Facebook Page ID required for Reels upload.
 * Profile connections and Page rows missing `facebookPageId` cannot publish Reels.
 * @param account - Connected Facebook account.
 * @returns Page ID when the connection can publish Reels, otherwise null.
 */
function resolveFacebookReelsPageId(account: ConnectedAccount): string | null {
  if (account.facebookTargetType === 'profile') {
    return null;
  }
  const pageId = account.facebookPageId?.trim();
  return pageId ? pageId : null;
}

/**
 * POSTs form-urlencoded parameters to a Graph API path using Bearer auth.
 * @param path - Graph API path relative to the API base (e.g. `{pageId}/video_reels`).
 * @param accessToken - Page access token.
 * @param params - Form body parameters (must not include `access_token`).
 * @param signal - Optional abort signal.
 * @returns Graph API fetch response.
 */
function postFacebookGraphForm(
  path: string,
  accessToken: string,
  params: URLSearchParams,
  signal?: AbortSignal
): Promise<Response> {
  return fetch(
    `${FACEBOOK_GRAPH_API_BASE}/${path}`,
    facebookGraphApiFetchInit(accessToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      ...(signal ? { signal } : {}),
    })
  );
}

/**
 * Uploads a video to Facebook as a Reel using the three-step Graph API flow.
 * @param input - Video stream, metadata, tokens, and connected account (for Page ID).
 * @returns Platform upload result with Reel URL on success.
 */
export async function uploadToFacebook(
  input: UploadToFacebookInput
): Promise<PlatformUploadResult> {
  if (!input.tokens.accessToken) {
    return toError('FACEBOOK_TOKEN_MISSING', 'Facebook Page access token is missing.');
  }

  const pageId = resolveFacebookReelsPageId(input.connectedAccount);
  if (!pageId) {
    return toError(
      'FACEBOOK_PAGE_CONNECTION_REQUIRED',
      'Facebook Reels require a connected Facebook Page. Reconnect and select a Page in Settings → Connections.'
    );
  }

  if (!input.contentLength || input.contentLength <= 0) {
    return toError(
      'FACEBOOK_CONTENT_LENGTH_REQUIRED',
      'Facebook uploads require a valid contentLength.'
    );
  }

  const { signal } = input;
  const pageAccessToken = input.tokens.accessToken;
  const videoState = input.metadata.facebookVideoState ?? 'PUBLISHED';

  if (videoState === 'SCHEDULED') {
    const scheduled = input.metadata.facebookScheduledPublishTime;
    if (scheduled === undefined) {
      return toError(
        'FACEBOOK_SCHEDULE_TIME_MISSING',
        'Scheduled publish time is required when video state is SCHEDULED.'
      );
    }
    const scheduleError = validateFacebookScheduledPublishTime(scheduled);
    if (scheduleError) {
      return toError('FACEBOOK_SCHEDULE_TIME_INVALID', scheduleError);
    }
  }

  const safeTitle = input.metadata.title.trim() || 'Untitled video';
  const safeDescription = input.metadata.description.trim();

  let videoId: string | undefined;

  try {
    const startRes = await postFacebookGraphForm(
      `${pageId}/video_reels`,
      pageAccessToken,
      new URLSearchParams({ upload_phase: 'START' }),
      signal
    );
    const startBody = (await startRes.json().catch(() => ({}))) as FacebookReelsStartResponse;
    if (!startRes.ok || !startBody.video_id) {
      return toError(
        'FACEBOOK_REELS_START_FAILED',
        startBody.error?.message ?? 'Failed to initialize Facebook Reels upload session.',
        startRes.status,
        JSON.stringify(startBody)
      );
    }
    videoId = startBody.video_id;
    const ruploadUrl = resolveFacebookReelsUploadUrl(videoId, startBody.upload_url);

    const ruploadInit: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${pageAccessToken}`,
        offset: '0',
        file_size: String(input.contentLength),
        'Content-Type': 'application/octet-stream',
      },
      body: input.videoStream,
      duplex: 'half',
      ...(signal ? { signal } : {}),
    };
    const ruploadRes = await fetch(ruploadUrl, ruploadInit);
    if (!ruploadRes.ok) {
      const ruploadText = await ruploadRes.text().catch(() => undefined);
      return toError(
        'FACEBOOK_REELS_UPLOAD_FAILED',
        'Failed to upload video bytes to Facebook.',
        ruploadRes.status,
        ruploadText
      );
    }

    const finishParams = new URLSearchParams({
      upload_phase: 'FINISH',
      video_id: videoId,
      video_state: videoState,
      title: safeTitle,
      description: safeDescription,
    });
    if (videoState === 'SCHEDULED' && input.metadata.facebookScheduledPublishTime !== undefined) {
      finishParams.set(
        'scheduled_publish_time',
        String(Math.floor(input.metadata.facebookScheduledPublishTime))
      );
    }

    const finishRes = await postFacebookGraphForm(
      `${pageId}/video_reels`,
      pageAccessToken,
      finishParams,
      signal
    );
    const finishBody = (await finishRes.json().catch(() => ({}))) as FacebookReelsFinishResponse;
    if (!finishRes.ok || finishBody.success !== true) {
      return toError(
        'FACEBOOK_REELS_FINISH_FAILED',
        finishBody.error?.message ?? 'Failed to publish Facebook Reel.',
        finishRes.status,
        JSON.stringify(finishBody)
      );
    }

    const thumbKey = input.metadata.thumbnailR2Key?.trim();
    if (thumbKey && videoId) {
      try {
        const opened = await getObjectWebStream(thumbKey, { signal });
        if (opened.contentLength > MAX_DRAFT_THUMBNAIL_BYTES) {
          await opened.stream.cancel().catch(() => undefined);
          console.warn('[uploadToFacebook] Thumbnail exceeds max size; skipping thumbnail upload.');
        } else {
          const thumbBytes = await readSmallStreamToArrayBuffer(opened.stream, signal);
          const contentType = facebookThumbnailContentType(
            input.metadata.thumbnailContentType,
            opened.contentType
          );
          const form = new FormData();
          form.append('is_preferred', 'true');
          form.append(
            'source',
            new Blob([thumbBytes], { type: contentType }),
            `thumbnail.${contentType === 'image/png' ? 'png' : 'jpg'}`
          );
          const thumbRes = await fetch(
            `${FACEBOOK_GRAPH_API_BASE}/${videoId}/thumbnails`,
            facebookGraphApiFetchInit(pageAccessToken, {
              method: 'POST',
              body: form,
              ...(signal ? { signal } : {}),
            })
          );
          if (!thumbRes.ok) {
            const thumbText = await thumbRes.text().catch(() => undefined);
            console.warn(
              '[uploadToFacebook] Thumbnail upload failed (best-effort):',
              thumbRes.status,
              thumbText
            );
          }
        }
      } catch (thumbErr) {
        console.warn(
          '[uploadToFacebook] Thumbnail upload failed (best-effort):',
          messageFromThrown(thumbErr)
        );
      }
    }

    return {
      ok: true,
      platformVideoId: videoId,
      platformUrl: `https://www.facebook.com/reel/${videoId}`,
    };
  } catch (err) {
    if (signal?.aborted) {
      return toError('FACEBOOK_UPLOAD_ABORTED', 'Facebook upload was aborted.');
    }
    return toError(
      'FACEBOOK_UPLOAD_FAILED',
      'Facebook upload failed.',
      500,
      messageFromThrown(err)
    );
  }
}
