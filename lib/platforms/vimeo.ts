import type { PlatformUploadVisibility } from '@/types';
import type {
  PlatformUploadMetadata,
  PlatformUploadResult,
  PlatformUploadTokens,
} from '@/lib/platforms/youtube';

interface UploadToVimeoInput {
  videoUrl?: string;
  videoStream?: ReadableStream<Uint8Array>;
  contentLength?: number;
  contentType?: string;
  metadata: PlatformUploadMetadata;
  tokens: PlatformUploadTokens;
}

interface VimeoCreateResponse {
  uri?: string;
  upload?: {
    upload_link?: string;
  };
}

const VIMEO_CREATE_VIDEO_URL = 'https://api.vimeo.com/me/videos';

function visibilityToVimeoPrivacy(
  visibility: PlatformUploadVisibility
): 'anybody' | 'unlisted' | 'nobody' {
  if (visibility === 'private') return 'nobody';
  if (visibility === 'unlisted') return 'unlisted';
  return 'anybody';
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

async function getVideoSource(input: UploadToVimeoInput): Promise<
  | {
      stream: ReadableStream<Uint8Array>;
      contentLength: number;
      contentType: string;
    }
  | PlatformUploadResult
> {
  if (input.videoStream) {
    if (!input.contentLength || input.contentLength <= 0) {
      return toError(
        'VIMEO_CONTENT_LENGTH_REQUIRED',
        'Vimeo uploads require a valid contentLength.'
      );
    }

    return {
      stream: input.videoStream,
      contentLength: input.contentLength,
      contentType: input.contentType ?? 'application/octet-stream',
    };
  }

  if (!input.videoUrl) {
    return toError('VIMEO_SOURCE_MISSING', 'Video source is required (videoUrl or videoStream).');
  }

  const response = await fetch(input.videoUrl, { method: 'GET' });
  if (!response.ok || !response.body) {
    return toError(
      'VIMEO_SOURCE_FETCH_FAILED',
      'Failed to read source video from storage.',
      response.status || 500,
      await response.text().catch(() => undefined)
    );
  }

  const contentLengthHeader = response.headers.get('content-length');
  if (!contentLengthHeader) {
    return toError(
      'VIMEO_CONTENT_LENGTH_MISSING',
      'Could not determine source video size for Vimeo upload.'
    );
  }

  const contentLength = Number(contentLengthHeader);
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    return toError(
      'VIMEO_CONTENT_LENGTH_INVALID',
      'Source video size is invalid for Vimeo upload.'
    );
  }

  return {
    stream: response.body,
    contentLength,
    contentType:
      response.headers.get('content-type') || input.contentType || 'application/octet-stream',
  };
}

function extractVimeoVideoId(uri?: string): string | null {
  if (!uri) return null;
  const parts = uri.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

export async function uploadToVimeo(input: UploadToVimeoInput): Promise<PlatformUploadResult> {
  if (!input.tokens.accessToken) {
    return toError('VIMEO_TOKEN_MISSING', 'Vimeo access token is missing.');
  }

  try {
    const videoSource = await getVideoSource(input);
    if ('ok' in videoSource) return videoSource;

    const createResponse = await fetch(VIMEO_CREATE_VIDEO_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.tokens.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.vimeo.*+json;version=3.4',
      },
      body: JSON.stringify({
        upload: {
          approach: 'tus',
          size: String(videoSource.contentLength),
        },
        privacy: {
          view: visibilityToVimeoPrivacy(input.metadata.visibility),
        },
      }),
    });

    if (!createResponse.ok) {
      return toError(
        'VIMEO_CREATE_VIDEO_FAILED',
        'Failed to create Vimeo video entry.',
        createResponse.status,
        await createResponse.text().catch(() => undefined)
      );
    }

    const createPayload = (await createResponse.json().catch(() => ({}))) as VimeoCreateResponse;
    const uploadLink = createPayload.upload?.upload_link;
    const videoId = extractVimeoVideoId(createPayload.uri);

    if (!uploadLink || !videoId || !createPayload.uri) {
      return toError(
        'VIMEO_UPLOAD_LINK_MISSING',
        'Vimeo upload link or video ID was not returned.'
      );
    }

    const tusUploadInit: RequestInit & { duplex: 'half' } = {
      method: 'PATCH',
      headers: {
        'Tus-Resumable': '1.0.0',
        'Upload-Offset': '0',
        'Content-Type': 'application/offset+octet-stream',
        'Content-Length': String(videoSource.contentLength),
      },
      body: videoSource.stream,
      duplex: 'half',
    };

    const tusUploadResponse = await fetch(uploadLink, tusUploadInit);
    if (!tusUploadResponse.ok) {
      return toError(
        'VIMEO_TUS_UPLOAD_FAILED',
        'Vimeo tus upload failed.',
        tusUploadResponse.status,
        await tusUploadResponse.text().catch(() => undefined)
      );
    }

    const metadataResponse = await fetch(`https://api.vimeo.com${createPayload.uri}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${input.tokens.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.vimeo.*+json;version=3.4',
      },
      body: JSON.stringify({
        name: input.metadata.title,
        description: input.metadata.description,
        tags: input.metadata.tags.map((tag) => ({ tag })),
      }),
    });

    if (!metadataResponse.ok) {
      return toError(
        'VIMEO_METADATA_PATCH_FAILED',
        'Vimeo upload succeeded but setting metadata failed.',
        metadataResponse.status,
        await metadataResponse.text().catch(() => undefined)
      );
    }

    return {
      ok: true,
      platformVideoId: videoId,
      platformUrl: `https://vimeo.com/${videoId}`,
    };
  } catch (error) {
    return toError(
      'VIMEO_UPLOAD_ERROR',
      'Unexpected Vimeo upload error.',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}
