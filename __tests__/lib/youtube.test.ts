import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetObjectWebStream = vi.fn();

vi.mock('@/lib/r2', () => ({
  getObjectWebStream: (...args: unknown[]) => mockGetObjectWebStream(...args),
}));

import * as youtube from '@/lib/platforms/youtube';
import type { PlatformUploadMetadata } from '@/lib/platforms/types';

function makeVideoStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
}

function makeThumbnailStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([9, 8, 7, 6]));
      controller.close();
    },
  });
}

const BASE_UPLOAD_METADATA: PlatformUploadMetadata = {
  title: 'Test video',
  description: 'Test description',
  tags: [],
  visibility: 'public',
};

async function runResumableInitUpload(
  metadata: PlatformUploadMetadata
): Promise<{ body: Record<string, unknown>; initUrl: string }> {
  const fetchMock = vi.mocked(global.fetch as unknown as (...args: unknown[]) => unknown);
  const sessionUrl = 'https://upload.youtube.test/session/resumable-init';
  let capturedInitBody: Record<string, unknown> | undefined;
  let capturedInitUrl = '';

  fetchMock.mockImplementation((url: unknown, options?: { method?: string; body?: string }) => {
    const sUrl = String(url);
    const method = options?.method;

    if (method === 'POST' && sUrl.includes('/upload/youtube/v3/videos?uploadType=resumable')) {
      capturedInitUrl = sUrl;
      capturedInitBody = JSON.parse(options?.body ?? '{}') as Record<string, unknown>;
      return Promise.resolve(
        new Response(null, { status: 200, headers: { location: sessionUrl } })
      );
    }

    if (method === 'PUT' && sUrl === sessionUrl) {
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'yt-video-init' }), { status: 200 })
      );
    }

    return Promise.resolve(new Response('', { status: 200 }));
  });

  const result = await youtube.uploadToYouTube({
    videoStream: makeVideoStream(),
    contentLength: 3,
    contentType: 'video/mp4',
    metadata,
    tokens: { accessToken: 'tok' },
  });

  expect(result.ok).toBe(true);
  expect(capturedInitBody).toBeDefined();
  expect(capturedInitUrl).not.toBe('');
  return { body: capturedInitBody!, initUrl: capturedInitUrl };
}

describe('buildYouTubeResumableInitUrl', () => {
  it('omits notifySubscribers when notifications are enabled', () => {
    expect(youtube.buildYouTubeResumableInitUrl(true)).not.toContain('notifySubscribers');
  });

  it('adds notifySubscribers=false when notifications are disabled', () => {
    expect(youtube.buildYouTubeResumableInitUrl(false)).toContain('notifySubscribers=false');
  });
});

describe('uploadToYouTube resumable init body', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('includes recordingDate under recordingDetails', async () => {
    const { body } = await runResumableInitUpload({
      ...BASE_UPLOAD_METADATA,
      recordingDate: '2025-06-08',
    });

    expect(body.recordingDetails).toEqual({ recordingDate: '2025-06-08' });
  });

  it('omits recordingDetails when recording fields are absent', async () => {
    const { body } = await runResumableInitUpload(BASE_UPLOAD_METADATA);

    expect(body).not.toHaveProperty('recordingDetails');
  });

  it('sets status.privacyStatus to private when publishAt is set', async () => {
    const { body } = await runResumableInitUpload({
      ...BASE_UPLOAD_METADATA,
      visibility: 'public',
      publishAt: '2026-06-08T12:00:00.000Z',
    });

    expect(body.status).toEqual(
      expect.objectContaining({
        privacyStatus: 'private',
        publishAt: '2026-06-08T12:00:00.000Z',
      })
    );
  });

  it('omits notifySubscribers on the init URL by default', async () => {
    const { initUrl } = await runResumableInitUpload(BASE_UPLOAD_METADATA);
    expect(initUrl).not.toContain('notifySubscribers');
  });

  it('adds notifySubscribers=false on the init URL when disabled on metadata', async () => {
    const { initUrl } = await runResumableInitUpload({
      ...BASE_UPLOAD_METADATA,
      notifySubscribers: false,
    });
    expect(initUrl).toContain('notifySubscribers=false');
  });
});

describe('uploadToYouTube thumbnail path', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    mockGetObjectWebStream.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uploads a custom thumbnail from R2 after successful video upload', async () => {
    const fetchMock = vi.mocked(global.fetch as unknown as (...args: any[]) => any);
    const sessionUrl = 'https://upload.youtube.test/session/abc';
    const videoId = 'yt-video-123';

    mockGetObjectWebStream.mockResolvedValue({
      stream: makeThumbnailStream(),
      contentLength: 4,
      contentType: 'image/jpeg',
    });

    fetchMock.mockImplementation((url: unknown, options?: any) => {
      const sUrl = String(url);
      const method = options?.method;

      if (method === 'POST' && sUrl.includes('/upload/youtube/v3/videos?uploadType=resumable')) {
        return Promise.resolve(
          new Response(null, { status: 200, headers: { location: sessionUrl } })
        );
      }

      if (method === 'PUT' && sUrl === sessionUrl) {
        return Promise.resolve(new Response(JSON.stringify({ id: videoId }), { status: 200 }));
      }

      if (method === 'POST' && sUrl.includes('/upload/youtube/v3/thumbnails/set?videoId=')) {
        return Promise.resolve(
          new Response(JSON.stringify({ kind: 'youtube#thumbnailSetResponse' }), { status: 200 })
        );
      }

      return Promise.resolve(new Response('', { status: 200 }));
    });

    const result = await youtube.uploadToYouTube({
      videoStream: makeVideoStream(),
      contentLength: 3,
      contentType: 'video/mp4',
      metadata: {
        title: 't',
        description: 'd',
        tags: [],
        visibility: 'public',
        thumbnailR2Key: 'drafts/draft-1/thumb.jpg',
        thumbnailContentType: 'image/jpeg',
      },
      tokens: { accessToken: 'tok' },
    });

    expect(result.ok).toBe(true);
    expect(mockGetObjectWebStream).toHaveBeenCalledWith('drafts/draft-1/thumb.jpg', {
      signal: undefined,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/upload/youtube/v3/thumbnails/set?videoId=yt-video-123'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'image/jpeg',
        }),
      })
    );
  });

  it('returns YOUTUBE_THUMBNAIL_SET_FAILED when thumbnails.set is non-2xx', async () => {
    const fetchMock = vi.mocked(global.fetch as unknown as (...args: any[]) => any);
    const sessionUrl = 'https://upload.youtube.test/session/def';

    mockGetObjectWebStream.mockResolvedValue({
      stream: makeThumbnailStream(),
      contentLength: 4,
      contentType: 'image/png',
    });

    fetchMock.mockImplementation((url: unknown, options?: any) => {
      const sUrl = String(url);
      const method = options?.method;

      if (method === 'POST' && sUrl.includes('/upload/youtube/v3/videos?uploadType=resumable')) {
        return Promise.resolve(
          new Response(null, { status: 200, headers: { location: sessionUrl } })
        );
      }

      if (method === 'PUT' && sUrl === sessionUrl) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'yt-video-456' }), { status: 200 })
        );
      }

      if (method === 'POST' && sUrl.includes('/upload/youtube/v3/thumbnails/set?videoId=')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ error: { message: 'Forbidden', errors: [{ reason: 'forbidden' }] } }),
            { status: 403 }
          )
        );
      }

      return Promise.resolve(new Response('', { status: 200 }));
    });

    const result = await youtube.uploadToYouTube({
      videoStream: makeVideoStream(),
      contentLength: 3,
      contentType: 'video/mp4',
      metadata: {
        title: 't',
        description: 'd',
        tags: [],
        visibility: 'public',
        thumbnailR2Key: 'drafts/draft-2/thumb.png',
        thumbnailContentType: 'image/png',
      },
      tokens: { accessToken: 'tok' },
    });

    expect(result.ok).toBe(false);
    const err = (
      result as { ok: false; error: { code: string; statusCode?: number; details?: string } }
    ).error;
    expect(err.code).toBe('YOUTUBE_THUMBNAIL_SET_FAILED');
    expect(err.statusCode).toBe(403);
    expect(err.details?.toLowerCase()).toContain('forbidden');
  });

  it('rejects unsupported thumbnail content types before reading R2', async () => {
    const fetchMock = vi.mocked(global.fetch as unknown as (...args: any[]) => any);
    const sessionUrl = 'https://upload.youtube.test/session/ghi';

    fetchMock.mockImplementation((url: unknown, options?: any) => {
      const sUrl = String(url);
      const method = options?.method;

      if (method === 'POST' && sUrl.includes('/upload/youtube/v3/videos?uploadType=resumable')) {
        return Promise.resolve(
          new Response(null, { status: 200, headers: { location: sessionUrl } })
        );
      }

      if (method === 'PUT' && sUrl === sessionUrl) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'yt-video-789' }), { status: 200 })
        );
      }

      return Promise.resolve(new Response('', { status: 200 }));
    });

    const result = await youtube.uploadToYouTube({
      videoStream: makeVideoStream(),
      contentLength: 3,
      contentType: 'video/mp4',
      metadata: {
        title: 't',
        description: 'd',
        tags: [],
        visibility: 'public',
        thumbnailR2Key: 'drafts/draft-3/thumb.webp',
        thumbnailContentType: 'image/webp',
      },
      tokens: { accessToken: 'tok' },
    });

    expect(result.ok).toBe(false);
    const err = (result as { ok: false; error: { code: string; statusCode?: number } }).error;
    expect(err.code).toBe('YOUTUBE_THUMBNAIL_FORMAT');
    expect(err.statusCode).toBe(400);
    expect(mockGetObjectWebStream).not.toHaveBeenCalled();
  });

  it('rejects thumbnails larger than 2 MB and skips thumbnails.set call', async () => {
    const fetchMock = vi.mocked(global.fetch as unknown as (...args: any[]) => any);
    const sessionUrl = 'https://upload.youtube.test/session/jkl';
    let thumbnailSetCalled = false;

    const cancelSpy = vi.fn().mockResolvedValue(undefined);
    const thumbStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([9, 8, 7, 6]));
        controller.close();
      },
      cancel: cancelSpy,
    });

    mockGetObjectWebStream.mockResolvedValue({
      stream: thumbStream,
      contentLength: 2 * 1024 * 1024 + 1,
      contentType: 'image/jpeg',
    });

    fetchMock.mockImplementation((url: unknown, options?: any) => {
      const sUrl = String(url);
      const method = options?.method;

      if (method === 'POST' && sUrl.includes('/upload/youtube/v3/videos?uploadType=resumable')) {
        return Promise.resolve(
          new Response(null, { status: 200, headers: { location: sessionUrl } })
        );
      }

      if (method === 'PUT' && sUrl === sessionUrl) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'yt-video-999' }), { status: 200 })
        );
      }

      if (method === 'POST' && sUrl.includes('/upload/youtube/v3/thumbnails/set?videoId=')) {
        thumbnailSetCalled = true;
        return Promise.resolve(new Response('', { status: 200 }));
      }

      return Promise.resolve(new Response('', { status: 200 }));
    });

    const result = await youtube.uploadToYouTube({
      videoStream: makeVideoStream(),
      contentLength: 3,
      contentType: 'video/mp4',
      metadata: {
        title: 't',
        description: 'd',
        tags: [],
        visibility: 'public',
        thumbnailR2Key: 'drafts/draft-4/thumb.jpg',
        thumbnailContentType: 'image/jpeg',
      },
      tokens: { accessToken: 'tok' },
    });

    expect(result.ok).toBe(false);
    const err = (result as { ok: false; error: { code: string; statusCode?: number } }).error;
    expect(err.code).toBe('YOUTUBE_THUMBNAIL_TOO_LARGE');
    expect(err.statusCode).toBe(400);
    expect(thumbnailSetCalled).toBe(false);
    expect(cancelSpy).toHaveBeenCalledOnce();
  });

  it('uses R2 content-type as fallback when thumbnailContentType is absent', async () => {
    const fetchMock = vi.mocked(global.fetch as unknown as (...args: any[]) => any);
    const sessionUrl = 'https://upload.youtube.test/session/r2ct';
    const videoId = 'yt-video-r2ct';

    mockGetObjectWebStream.mockResolvedValue({
      stream: makeThumbnailStream(),
      contentLength: 4,
      contentType: 'image/png', // R2 reports PNG; no draft thumbnailContentType
    });

    let capturedContentType: string | undefined;
    fetchMock.mockImplementation((url: unknown, options?: any) => {
      const sUrl = String(url);
      const method = options?.method;

      if (method === 'POST' && sUrl.includes('/upload/youtube/v3/videos?uploadType=resumable')) {
        return Promise.resolve(
          new Response(null, { status: 200, headers: { location: sessionUrl } })
        );
      }
      if (method === 'PUT' && sUrl === sessionUrl) {
        return Promise.resolve(new Response(JSON.stringify({ id: videoId }), { status: 200 }));
      }
      if (method === 'POST' && sUrl.includes('/upload/youtube/v3/thumbnails/set?videoId=')) {
        capturedContentType = (options?.headers as Record<string, string>)?.['Content-Type'];
        return Promise.resolve(
          new Response(JSON.stringify({ kind: 'youtube#thumbnailSetResponse' }), { status: 200 })
        );
      }
      return Promise.resolve(new Response('', { status: 200 }));
    });

    const result = await youtube.uploadToYouTube({
      videoStream: makeVideoStream(),
      contentLength: 3,
      contentType: 'video/mp4',
      metadata: {
        title: 't',
        description: 'd',
        tags: [],
        visibility: 'public',
        thumbnailR2Key: 'drafts/draft-5/thumb.png',
        thumbnailContentType: undefined, // missing — should fall back to R2's image/png
      },
      tokens: { accessToken: 'tok' },
    });

    expect(result.ok).toBe(true);
    expect(capturedContentType).toBe('image/png');
  });
});

describe('youtubeFetchPlaylistsPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('omits playlists with missing or blank titles', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          items: [
            { id: 'pl-1', snippet: { title: 'Sermons' } },
            { id: 'pl-2', snippet: { title: '   ' } },
            { id: 'pl-3', snippet: {} },
            { id: '  pl-4  ', snippet: { title: '  Youth  ' } },
          ],
        })
      )
    );

    const result = await youtube.youtubeFetchPlaylistsPage('tok');

    expect(result).toEqual({
      ok: true,
      items: [
        { id: 'pl-1', title: 'Sermons' },
        { id: 'pl-4', title: 'Youth' },
      ],
    });
  });
});
