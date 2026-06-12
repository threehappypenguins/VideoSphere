import type { ConnectedAccount } from '@/types';
import {
  isAllowedDraftThumbnailContentType,
  MAX_DRAFT_THUMBNAIL_BYTES,
} from '@/lib/draft-thumbnail';
import { FACEBOOK_GRAPH_API_BASE } from '@/lib/platforms/facebook-oauth';
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

async function readStreamToArrayBuffer(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Aborted');
  }
  return new Response(stream).arrayBuffer();
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

  const pageId =
    input.connectedAccount.facebookPageId?.trim() || input.connectedAccount.platformUserId.trim();
  if (!pageId) {
    return toError('FACEBOOK_PAGE_ID_MISSING', 'Facebook Page ID is missing on the connection.');
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
    const startParams = new URLSearchParams({
      upload_phase: 'START',
      access_token: pageAccessToken,
    });
    const startRes = await fetch(
      `${FACEBOOK_GRAPH_API_BASE}/${pageId}/video_reels?${startParams}`,
      {
        method: 'POST',
        ...(signal ? { signal } : {}),
      }
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

    const videoBytes = await readStreamToArrayBuffer(input.videoStream, signal);
    const ruploadRes = await fetch(`${FACEBOOK_RUPLOAD_BASE}/${videoId}`, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${pageAccessToken}`,
        offset: '0',
        file_size: String(input.contentLength),
        'Content-Type': 'application/octet-stream',
      },
      body: videoBytes,
      ...(signal ? { signal } : {}),
    });
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
      access_token: pageAccessToken,
    });
    if (videoState === 'SCHEDULED' && input.metadata.facebookScheduledPublishTime !== undefined) {
      finishParams.set(
        'scheduled_publish_time',
        String(Math.floor(input.metadata.facebookScheduledPublishTime))
      );
    }
    const placeId = input.metadata.facebookPlaceId?.trim();
    if (placeId) {
      finishParams.set('place', placeId);
    }

    const finishRes = await fetch(
      `${FACEBOOK_GRAPH_API_BASE}/${pageId}/video_reels?${finishParams}`,
      {
        method: 'POST',
        ...(signal ? { signal } : {}),
      }
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
          const thumbBytes = await readStreamToArrayBuffer(opened.stream, signal);
          const thumbCt = input.metadata.thumbnailContentType?.trim().toLowerCase();
          const contentType =
            thumbCt && isAllowedDraftThumbnailContentType(thumbCt) ? thumbCt : 'image/jpeg';
          const form = new FormData();
          form.append('is_preferred', 'true');
          form.append('access_token', pageAccessToken);
          form.append(
            'source',
            new Blob([thumbBytes], { type: contentType }),
            `thumbnail.${contentType === 'image/png' ? 'png' : 'jpg'}`
          );
          const thumbRes = await fetch(`${FACEBOOK_GRAPH_API_BASE}/${videoId}/thumbnails`, {
            method: 'POST',
            body: form,
            ...(signal ? { signal } : {}),
          });
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
