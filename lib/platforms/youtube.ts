import type { PlatformUploadVisibility } from '@/types';

export interface PlatformUploadMetadata {
  title: string;
  description: string;
  tags: string[];
  visibility: PlatformUploadVisibility;
}

export interface PlatformUploadTokens {
  accessToken: string;
  refreshToken?: string;
  tokenExpiry?: string;
}

export interface PlatformUploadError {
  code: string;
  message: string;
  statusCode?: number;
  details?: string;
}

export type PlatformUploadResult =
  | { ok: true; platformVideoId: string; platformUrl: string }
  | { ok: false; error: PlatformUploadError };

interface UploadToYouTubeInput {
  videoUrl?: string;
  videoStream?: ReadableStream<Uint8Array>;
  contentLength?: number;
  contentType?: string;
  metadata: PlatformUploadMetadata;
  tokens: PlatformUploadTokens;
}

interface GoogleRefreshTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
}

const YOUTUBE_RESUMABLE_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_YOUTUBE_CATEGORY_ID = '22';

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

async function getVideoSource(input: UploadToYouTubeInput): Promise<
  | {
      stream: ReadableStream<Uint8Array>;
      contentLength?: number;
      contentType: string;
    }
  | PlatformUploadResult
> {
  if (input.videoStream) {
    return {
      stream: input.videoStream,
      contentLength: input.contentLength,
      contentType: input.contentType ?? 'application/octet-stream',
    };
  }

  if (!input.videoUrl) {
    return toError('YOUTUBE_SOURCE_MISSING', 'Video source is required (videoUrl or videoStream).');
  }

  const response = await fetch(input.videoUrl, { method: 'GET' });
  if (!response.ok || !response.body) {
    return toError(
      'YOUTUBE_SOURCE_FETCH_FAILED',
      'Failed to read source video from storage.',
      response.status || 500,
      await response.text().catch(() => undefined)
    );
  }

  return {
    stream: response.body,
    contentLength: response.headers.get('content-length')
      ? Number(response.headers.get('content-length'))
      : undefined,
    contentType:
      response.headers.get('content-type') || input.contentType || 'application/octet-stream',
  };
}

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

export async function uploadToYouTube(input: UploadToYouTubeInput): Promise<PlatformUploadResult> {
  if (!input.tokens.accessToken) {
    return toError('YOUTUBE_TOKEN_MISSING', 'YouTube access token is missing.');
  }

  try {
    const videoSource = await getVideoSource(input);
    if ('ok' in videoSource) return videoSource;

    const safeTitle = input.metadata.title.trim() || 'Untitled video';
    const safeDescription = input.metadata.description.trim();
    const safeTags = input.metadata.tags.filter((tag) => tag.trim().length > 0);

    const initResponse = await fetch(YOUTUBE_RESUMABLE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.tokens.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': videoSource.contentType,
        ...(videoSource.contentLength
          ? { 'X-Upload-Content-Length': String(videoSource.contentLength) }
          : {}),
      },
      body: JSON.stringify({
        snippet: {
          title: safeTitle,
          description: safeDescription,
          tags: safeTags,
          categoryId: DEFAULT_YOUTUBE_CATEGORY_ID,
        },
        status: {
          privacyStatus: visibilityToYouTubePrivacy(input.metadata.visibility),
        },
      }),
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

    const uploadRequestInit: RequestInit & { duplex: 'half' } = {
      method: 'PUT',
      headers: {
        'Content-Type': videoSource.contentType,
        ...(videoSource.contentLength
          ? { 'Content-Length': String(videoSource.contentLength) }
          : {}),
      },
      body: videoSource.stream,
      duplex: 'half',
    };

    const uploadResponse = await fetch(resumableUploadUrl, uploadRequestInit);

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
  } catch (error) {
    return toError(
      'YOUTUBE_UPLOAD_ERROR',
      'Unexpected YouTube upload error.',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}
