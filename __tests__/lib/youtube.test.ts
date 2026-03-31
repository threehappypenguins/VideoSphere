import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetObjectWebStream = vi.fn();

vi.mock('@/lib/r2', () => ({
  getObjectWebStream: (...args: unknown[]) => mockGetObjectWebStream(...args),
}));

import * as youtube from '@/lib/platforms/youtube';

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

    mockGetObjectWebStream.mockResolvedValue({
      stream: makeThumbnailStream(),
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
  });
});
