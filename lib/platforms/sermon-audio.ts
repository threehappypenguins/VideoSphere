import { formatSermonAudioLocalDate } from '@/lib/platforms/sermon-audio-event-types';
import { buildSermonAudioSocialSharingCreateFields } from '@/lib/platforms/sermon-audio-cross-publish';
import {
  SERMONAUDIO_API_BASE,
  resolveSermonAudioUploadUrl,
  sermonAudioJsonHeaders,
} from '@/lib/platforms/sermon-audio-http';
import { messageFromThrown } from '@/lib/utils/error-message';
import type {
  PlatformUploadError,
  PlatformUploadMetadata,
  PlatformUploadResult,
  PlatformUploadTokens,
} from '@/lib/platforms/types';

const SERMONAUDIO_SERMONS_URL = `${SERMONAUDIO_API_BASE}/v2/node/sermons`;
const SERMONAUDIO_MEDIA_URL = `${SERMONAUDIO_API_BASE}/v2/media`;

/** Far-future expiry for SermonAudio API keys (they do not expire). */
export const SERMONAUDIO_TOKEN_EXPIRY = '9999-12-31T00:00:00.000Z';

/** Default delay between SermonAudio processing polls (30 seconds). */
export const SERMONAUDIO_PROCESSING_POLL_INTERVAL_MS = 30_000;

/** Default maximum SermonAudio processing poll attempts (120 × 30s ≈ 1 hour). */
export const SERMONAUDIO_PROCESSING_MAX_ATTEMPTS = 120;

interface UploadToSermonAudioInput {
  videoStream: ReadableStream<Uint8Array>;
  contentLength: number;
  contentType?: string;
  metadata: PlatformUploadMetadata;
  tokens: PlatformUploadTokens;
  /** When set (e.g. distribute deadline), aborts fetch calls so timeouts stop real work. */
  signal?: AbortSignal;
}

interface PollSermonAudioProcessingInput {
  sermonID: string;
  tokens: PlatformUploadTokens;
  /** Delay between poll attempts in milliseconds. Defaults to {@link SERMONAUDIO_PROCESSING_POLL_INTERVAL_MS}. */
  intervalMs?: number;
  /** Maximum poll attempts before rejecting. Defaults to {@link SERMONAUDIO_PROCESSING_MAX_ATTEMPTS}. */
  maxAttempts?: number;
  signal?: AbortSignal;
}

interface PublishSermonAudioInput {
  sermonID: string;
  tokens: PlatformUploadTokens;
  signal?: AbortSignal;
}

interface SermonCreateResponse {
  sermonID?: string;
}

interface MediaCreateResponse {
  uploadURL?: string;
}

interface SermonMediaPayload {
  media?: {
    video?: Array<{
      thumbnailImageURL?: string | null;
    }>;
  };
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

function toPlatformUploadError(
  code: string,
  message: string,
  statusCode?: number,
  details?: string
): Error & PlatformUploadError {
  const error = new Error(message) as Error & PlatformUploadError;
  error.name = 'PlatformUploadError';
  error.code = code;
  if (statusCode !== undefined) {
    error.statusCode = statusCode;
  }
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

async function readApiErrorDetails(response: Response): Promise<string | undefined> {
  try {
    return await response.text();
  } catch {
    return undefined;
  }
}

function requireApiKey(tokens: PlatformUploadTokens): string | null {
  const key = tokens.accessToken.trim();
  return key.length > 0 ? key : null;
}

function buildCreateSermonBody(metadata: PlatformUploadMetadata): Record<string, unknown> {
  const fullTitle = metadata.fullTitle?.trim() || metadata.title.trim() || 'Untitled sermon';
  const preachDate = metadata.preachDate?.trim() || formatSermonAudioLocalDate();

  const body: Record<string, unknown> = {
    fullTitle,
    preachDate,
    acceptCopyright: metadata.acceptCopyright ?? true,
  };

  if (metadata.displayTitle?.trim()) body.displayTitle = metadata.displayTitle.trim();
  if (metadata.seriesID != null && Number.isInteger(metadata.seriesID) && metadata.seriesID > 0) {
    body.seriesID = metadata.seriesID;
  } else if (metadata.subtitle?.trim()) {
    body.subtitle = metadata.subtitle.trim();
  }
  if (
    metadata.speakerID != null &&
    Number.isInteger(metadata.speakerID) &&
    metadata.speakerID > 0
  ) {
    body.speakerID = metadata.speakerID;
  } else if (metadata.speakerName?.trim()) {
    body.speakerName = metadata.speakerName.trim();
  }
  if (metadata.eventType?.trim()) body.eventType = metadata.eventType.trim();
  if (metadata.bibleText?.trim()) body.bibleText = metadata.bibleText.trim();
  if (metadata.moreInfoText?.trim()) body.moreInfoText = metadata.moreInfoText.trim();
  if (metadata.keywords?.trim()) body.keywords = metadata.keywords.trim();
  if (metadata.languageCode?.trim()) body.languageCode = metadata.languageCode.trim();

  const socialSharingFields = buildSermonAudioSocialSharingCreateFields(metadata.crossPublish, {
    defaultTitle: fullTitle,
    defaultDescription: metadata.description?.trim() || metadata.moreInfoText?.trim(),
  });
  if (socialSharingFields) {
    Object.assign(body, socialSharingFields);
  }

  return body;
}

function hasSermonVideoThumbnail(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  const thumbnailImageURL = (item as { thumbnailImageURL?: unknown }).thumbnailImageURL;
  return typeof thumbnailImageURL === 'string' && thumbnailImageURL.trim().length > 0;
}

/**
 * True when SA has generated a video thumbnail on any `media.video` entry.
 * Intentionally thumbnail-only: transcoding can finish before SA extracts the poster frame,
 * so do not gate on `videoCodec`, `adaptiveBitrate`, or `videoMediaStatus` alone.
 */
function sermonVideoIsReady(payload: unknown): boolean {
  if (payload === null || typeof payload !== 'object') return false;
  const media = (payload as SermonMediaPayload).media;
  if (!media || !Array.isArray(media.video)) return false;
  // Any video rendition with a thumbnail URL means post-processing (including poster extraction) is done.
  return media.video.some((item) => hasSermonVideoThumbnail(item));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function delayOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return delay(ms);
  if (signal.aborted) {
    return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'));
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
    };
    const id = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      cleanup();
      reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Creates a SermonAudio sermon record, uploads video media, and returns the sermon id and public URL.
 * @param input - Video stream, metadata, API key tokens, and optional abort signal.
 * @returns Upload result with `platformVideoId` set to the SermonAudio `sermonID`.
 */
export async function uploadToSermonAudio(
  input: UploadToSermonAudioInput
): Promise<PlatformUploadResult> {
  const apiKey = requireApiKey(input.tokens);
  if (!apiKey) {
    return toError('SERMONAUDIO_API_KEY_MISSING', 'SermonAudio API key is missing.');
  }

  if (!input.contentLength || input.contentLength <= 0) {
    return toError(
      'SERMONAUDIO_CONTENT_LENGTH_REQUIRED',
      'SermonAudio uploads require a valid contentLength.'
    );
  }

  const { signal } = input;
  const contentType = input.contentType?.trim() || 'application/octet-stream';

  try {
    const createResponse = await fetch(SERMONAUDIO_SERMONS_URL, {
      method: 'POST',
      headers: sermonAudioJsonHeaders(apiKey),
      body: JSON.stringify(buildCreateSermonBody(input.metadata)),
      ...(signal ? { signal } : {}),
    });

    if (!createResponse.ok) {
      return toError(
        'SERMONAUDIO_CREATE_SERMON_FAILED',
        'Failed to create SermonAudio sermon record.',
        createResponse.status,
        await readApiErrorDetails(createResponse)
      );
    }

    const createPayload = (await createResponse.json().catch(() => ({}))) as SermonCreateResponse;
    const sermonID = createPayload.sermonID?.trim();
    if (!sermonID) {
      return toError(
        'SERMONAUDIO_SERMON_ID_MISSING',
        'SermonAudio create sermon succeeded but no sermonID was returned.'
      );
    }

    const mediaResponse = await fetch(SERMONAUDIO_MEDIA_URL, {
      method: 'POST',
      headers: sermonAudioJsonHeaders(apiKey),
      body: JSON.stringify({
        uploadType: 'original-video',
        sermonID,
      }),
      ...(signal ? { signal } : {}),
    });

    if (!mediaResponse.ok) {
      return toError(
        'SERMONAUDIO_CREATE_MEDIA_FAILED',
        'Failed to create SermonAudio media upload.',
        mediaResponse.status,
        await readApiErrorDetails(mediaResponse)
      );
    }

    const mediaPayload = (await mediaResponse.json().catch(() => ({}))) as MediaCreateResponse;
    const uploadURL = mediaPayload.uploadURL?.trim();
    if (!uploadURL) {
      return toError(
        'SERMONAUDIO_UPLOAD_URL_MISSING',
        'SermonAudio media create succeeded but no uploadURL was returned.'
      );
    }

    const validatedUploadURL = resolveSermonAudioUploadUrl(uploadURL);
    if (!validatedUploadURL) {
      return toError(
        'SERMONAUDIO_UPLOAD_URL_INVALID',
        'SermonAudio media create returned an invalid or untrusted uploadURL.'
      );
    }

    const uploadInit: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(input.contentLength),
      },
      body: input.videoStream,
      duplex: 'half',
      redirect: 'error',
      ...(signal ? { signal } : {}),
    };

    const uploadResponse = await fetch(validatedUploadURL, uploadInit);
    if (!uploadResponse.ok) {
      return toError(
        'SERMONAUDIO_MEDIA_UPLOAD_FAILED',
        'SermonAudio video upload failed.',
        uploadResponse.status,
        await readApiErrorDetails(uploadResponse)
      );
    }

    return {
      ok: true,
      platformVideoId: sermonID,
      platformUrl: `https://www.sermonaudio.com/sermons/${sermonID}`,
    };
  } catch (error) {
    return toError(
      'SERMONAUDIO_UPLOAD_UNEXPECTED',
      'Unexpected error during SermonAudio upload.',
      undefined,
      messageFromThrown(error)
    );
  }
}

/**
 * Polls SermonAudio until sermon video processing completes: any `media.video` entry with a
 * non-empty `thumbnailImageURL` (SA generates the thumbnail after the video is processed).
 * @param input - Sermon id, API key tokens, poll tuning, and optional abort signal.
 * @returns Resolves when processing is complete.
 * @throws When polling is aborted or `maxAttempts` is exceeded.
 */
export async function pollSermonAudioProcessing(
  input: PollSermonAudioProcessingInput
): Promise<void> {
  const apiKey = requireApiKey(input.tokens);
  if (!apiKey) {
    throw toPlatformUploadError('SERMONAUDIO_API_KEY_MISSING', 'SermonAudio API key is missing.');
  }

  const sermonID = input.sermonID.trim();
  if (!sermonID) {
    throw toPlatformUploadError(
      'SERMONAUDIO_SERMON_ID_MISSING',
      'SermonAudio sermonID is missing.'
    );
  }

  const intervalMs = input.intervalMs ?? SERMONAUDIO_PROCESSING_POLL_INTERVAL_MS;
  const maxAttempts = input.maxAttempts ?? SERMONAUDIO_PROCESSING_MAX_ATTEMPTS;
  const pollUrl = `${SERMONAUDIO_SERMONS_URL}/${encodeURIComponent(sermonID)}?allowUnpublished=true`;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (input.signal?.aborted) {
      throw input.signal.reason instanceof Error ? input.signal.reason : new Error('Aborted');
    }

    const response = await fetch(pollUrl, {
      method: 'GET',
      headers: {
        'X-Api-Key': apiKey,
        Accept: 'application/json',
      },
      ...(input.signal ? { signal: input.signal } : {}),
    });

    if (!response.ok) {
      throw toPlatformUploadError(
        'SERMONAUDIO_POLL_FAILED',
        'Failed to poll SermonAudio sermon processing status.',
        response.status,
        await readApiErrorDetails(response)
      );
    }

    const payload = await response.json().catch(() => ({}));
    if (sermonVideoIsReady(payload)) {
      return;
    }

    if (attempt >= maxAttempts) {
      throw toPlatformUploadError(
        'SERMONAUDIO_PROCESSING_TIMEOUT',
        `SermonAudio video processing did not complete after ${maxAttempts} poll attempts.`
      );
    }

    await delayOrAbort(intervalMs, input.signal);
  }
}

/**
 * Publishes a SermonAudio sermon by PATCHing `publishDate` to today's local calendar date (`YYYY-MM-DD`).
 * Cross Publish options must already be on the sermon from the create POST (`socialSharing`);
 * publishing triggers SA to run the configured cross-posts once video processing is complete.
 * @param input - Sermon id, API key tokens, and optional abort signal.
 * @throws When the publish request fails.
 */
export async function publishSermonAudio(input: PublishSermonAudioInput): Promise<void> {
  const apiKey = requireApiKey(input.tokens);
  if (!apiKey) {
    throw toPlatformUploadError('SERMONAUDIO_API_KEY_MISSING', 'SermonAudio API key is missing.');
  }

  const sermonID = input.sermonID.trim();
  if (!sermonID) {
    throw toPlatformUploadError(
      'SERMONAUDIO_SERMON_ID_MISSING',
      'SermonAudio sermonID is missing.'
    );
  }

  const publishUrl = `${SERMONAUDIO_SERMONS_URL}/${encodeURIComponent(sermonID)}`;
  const response = await fetch(publishUrl, {
    method: 'PATCH',
    headers: sermonAudioJsonHeaders(apiKey),
    body: JSON.stringify({
      publishDate: formatSermonAudioLocalDate(),
    }),
    ...(input.signal ? { signal: input.signal } : {}),
  });

  if (!response.ok) {
    throw toPlatformUploadError(
      'SERMONAUDIO_PUBLISH_FAILED',
      'Failed to publish SermonAudio sermon.',
      response.status,
      await readApiErrorDetails(response)
    );
  }
}
