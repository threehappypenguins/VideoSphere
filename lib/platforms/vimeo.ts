import type { PlatformUploadVisibility } from '@/types';
import type {
  PlatformUploadMetadata,
  PlatformUploadResult,
  PlatformUploadTokens,
} from '@/lib/platforms/youtube';

interface UploadToVimeoInput {
  videoStream: ReadableStream<Uint8Array>;
  contentLength: number;
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
    if (!input.contentLength || input.contentLength <= 0) {
      return toError(
        'VIMEO_CONTENT_LENGTH_REQUIRED',
        'Vimeo uploads require a valid contentLength.'
      );
    }

    const videoSource = {
      stream: input.videoStream,
      contentLength: input.contentLength,
      contentType: input.contentType ?? 'application/octet-stream',
    };

    const safeTitle = input.metadata.title.trim() || 'Untitled video';
    const safeDescription = input.metadata.description.trim();

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
        name: safeTitle,
        description: safeDescription,
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
