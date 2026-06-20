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

describe('summarizeYouTubeResumableInitBodyForLog', () => {
  it('redacts user-provided snippet text to lengths and counts', () => {
    const summary = youtube.summarizeYouTubeResumableInitBodyForLog(
      'https://upload.youtube.test/resumable',
      {
        snippet: {
          title: 'Private sermon title',
          description: 'Full description body',
          tags: ['faith', 'hope'],
          categoryId: '22',
          defaultAudioLanguage: 'en',
        },
        status: { privacyStatus: 'private', publishAt: '2026-06-08T12:00:00.000Z' },
        recordingDetails: { recordingDate: '2026-06-07' },
      }
    );

    expect(summary).toEqual({
      initUrl: 'https://upload.youtube.test/resumable',
      snippet: {
        titleLength: 20,
        descriptionLength: 21,
        tagCount: 2,
        categoryId: '22',
        defaultAudioLanguage: 'en',
      },
      status: { privacyStatus: 'private', publishAt: '2026-06-08T12:00:00.000Z' },
      recordingDetails: { recordingDate: '2026-06-07' },
    });
    expect(JSON.stringify(summary)).not.toContain('Private sermon title');
    expect(JSON.stringify(summary)).not.toContain('faith');
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

  it('does not modify title or description when isShort is true', async () => {
    const { body } = await runResumableInitUpload({
      ...BASE_UPLOAD_METADATA,
      title: 'My sermon',
      description: 'Watch this message.',
      isShort: true,
    });

    expect(body.snippet).toEqual(
      expect.objectContaining({
        title: 'My sermon',
        description: 'Watch this message.',
      })
    );
  });

  it('returns a youtube.com/shorts URL when isShort is true', async () => {
    const fetchMock = vi.mocked(global.fetch as unknown as (...args: unknown[]) => unknown);
    const sessionUrl = 'https://upload.youtube.test/session/shorts';

    fetchMock.mockImplementation((url: unknown, options?: { method?: string }) => {
      const sUrl = String(url);
      const method = options?.method;

      if (method === 'POST' && sUrl.includes('/upload/youtube/v3/videos?uploadType=resumable')) {
        return Promise.resolve(
          new Response(null, { status: 200, headers: { location: sessionUrl } })
        );
      }

      if (method === 'PUT' && sUrl === sessionUrl) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'short-video-id' }), { status: 200 })
        );
      }

      return Promise.resolve(new Response('', { status: 200 }));
    });

    const result = await youtube.uploadToYouTube({
      videoStream: makeVideoStream(),
      contentLength: 3,
      contentType: 'video/mp4',
      metadata: {
        ...BASE_UPLOAD_METADATA,
        isShort: true,
      },
      tokens: { accessToken: 'tok' },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.platformUrl).toBe('https://www.youtube.com/shorts/short-video-id');
    }
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

describe('uploadToYouTube resumable session reuse', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function makeVideoStreamOfLength(totalBytes: number): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(totalBytes).fill(7));
        controller.close();
      },
    });
  }

  it('resumes from a probed byte offset without creating a new session', async () => {
    const fetchMock = vi.mocked(global.fetch as unknown as (...args: unknown[]) => unknown);
    const storedSession = 'https://upload.youtube.test/session/stored';
    const persistResumableState = vi.fn().mockResolvedValue(undefined);
    const clearResumableState = vi.fn().mockResolvedValue(undefined);
    let initPostCount = 0;

    fetchMock.mockImplementation(
      (url: unknown, options?: { method?: string; headers?: Record<string, string> }) => {
        const sUrl = String(url);
        const method = options?.method;
        const headers = options?.headers ?? {};

        if (method === 'POST' && sUrl.includes('/upload/youtube/v3/videos?uploadType=resumable')) {
          initPostCount += 1;
          return Promise.resolve(
            new Response(null, {
              status: 200,
              headers: { location: 'https://upload.youtube.test/session/new' },
            })
          );
        }

        if (
          method === 'PUT' &&
          sUrl === storedSession &&
          headers['Content-Range'] === 'bytes */512'
        ) {
          return Promise.resolve(
            new Response(null, { status: 308, headers: { Range: 'bytes 0-255' } })
          );
        }

        if (
          method === 'PUT' &&
          sUrl === storedSession &&
          headers['Content-Range'] === 'bytes 256-511/512'
        ) {
          return Promise.resolve(
            new Response(JSON.stringify({ id: 'resumed-video-id' }), { status: 200 })
          );
        }

        return Promise.resolve(new Response('', { status: 200 }));
      }
    );

    const result = await youtube.uploadToYouTube({
      videoStream: makeVideoStreamOfLength(512),
      contentLength: 512,
      contentType: 'video/mp4',
      metadata: BASE_UPLOAD_METADATA,
      tokens: { accessToken: 'tok' },
      resumableState: {
        resumableUploadUrl: storedSession,
        resumableBytesConfirmed: 128,
        resumableUpdatedAt: '2026-06-20T10:00:00.000Z',
      },
      persistResumableState,
      clearResumableState,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.platformVideoId).toBe('resumed-video-id');
    }
    expect(initPostCount).toBe(0);
    expect(persistResumableState).toHaveBeenCalledWith(
      expect.objectContaining({
        resumableUploadUrl: storedSession,
        resumableBytesConfirmed: 512,
      })
    );
    expect(clearResumableState).toHaveBeenCalledTimes(1);
  });

  it('discards an invalid stored session, clears it, and starts a fresh upload', async () => {
    const fetchMock = vi.mocked(global.fetch as unknown as (...args: unknown[]) => unknown);
    const storedSession = 'https://upload.youtube.test/session/expired';
    const freshSession = 'https://upload.youtube.test/session/fresh';
    const persistResumableState = vi.fn().mockResolvedValue(undefined);
    const clearResumableState = vi.fn().mockResolvedValue(undefined);

    fetchMock.mockImplementation(
      (url: unknown, options?: { method?: string; headers?: Record<string, string> }) => {
        const sUrl = String(url);
        const method = options?.method;
        const headers = options?.headers ?? {};

        if (
          method === 'PUT' &&
          sUrl === storedSession &&
          headers['Content-Range'] === 'bytes */512'
        ) {
          return Promise.resolve(new Response('', { status: 404 }));
        }

        if (method === 'POST' && sUrl.includes('/upload/youtube/v3/videos?uploadType=resumable')) {
          return Promise.resolve(
            new Response(null, { status: 200, headers: { location: freshSession } })
          );
        }

        if (
          method === 'PUT' &&
          sUrl === freshSession &&
          headers['Content-Range'] === 'bytes 0-511/512'
        ) {
          return Promise.resolve(
            new Response(JSON.stringify({ id: 'fresh-video-id' }), { status: 200 })
          );
        }

        return Promise.resolve(new Response('', { status: 200 }));
      }
    );

    const result = await youtube.uploadToYouTube({
      videoStream: makeVideoStreamOfLength(512),
      contentLength: 512,
      contentType: 'video/mp4',
      metadata: BASE_UPLOAD_METADATA,
      tokens: { accessToken: 'tok' },
      resumableState: {
        resumableUploadUrl: storedSession,
        resumableBytesConfirmed: 256,
        resumableUpdatedAt: '2026-06-20T10:00:00.000Z',
      },
      persistResumableState,
      clearResumableState,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.platformVideoId).toBe('fresh-video-id');
    }
    expect(clearResumableState).toHaveBeenCalledTimes(2);
    expect(persistResumableState).toHaveBeenCalledWith(
      expect.objectContaining({
        resumableUploadUrl: freshSession,
        resumableBytesConfirmed: 0,
      })
    );
  });

  it('clears resumable fields after a successful upload from a new session', async () => {
    const fetchMock = vi.mocked(global.fetch as unknown as (...args: unknown[]) => unknown);
    const sessionUrl = 'https://upload.youtube.test/session/new-success';
    const clearResumableState = vi.fn().mockResolvedValue(undefined);
    const persistResumableState = vi.fn().mockResolvedValue(undefined);

    fetchMock.mockImplementation(
      (url: unknown, options?: { method?: string; headers?: Record<string, string> }) => {
        const sUrl = String(url);
        const method = options?.method;
        const headers = options?.headers ?? {};

        if (method === 'POST' && sUrl.includes('/upload/youtube/v3/videos?uploadType=resumable')) {
          return Promise.resolve(
            new Response(null, { status: 200, headers: { location: sessionUrl } })
          );
        }

        if (
          method === 'PUT' &&
          sUrl === sessionUrl &&
          headers['Content-Range'] === 'bytes 0-511/512'
        ) {
          return Promise.resolve(
            new Response(JSON.stringify({ id: 'success-video-id' }), { status: 200 })
          );
        }

        return Promise.resolve(new Response('', { status: 200 }));
      }
    );

    const result = await youtube.uploadToYouTube({
      videoStream: makeVideoStreamOfLength(512),
      contentLength: 512,
      contentType: 'video/mp4',
      metadata: BASE_UPLOAD_METADATA,
      tokens: { accessToken: 'tok' },
      persistResumableState,
      clearResumableState,
    });

    expect(result.ok).toBe(true);
    expect(persistResumableState).toHaveBeenCalledWith(
      expect.objectContaining({
        resumableUploadUrl: sessionUrl,
        resumableBytesConfirmed: 0,
      })
    );
    expect(clearResumableState).toHaveBeenCalledTimes(1);
  });

  it('clears resumable fields once when a stored session probe reports the upload is already complete', async () => {
    const fetchMock = vi.mocked(global.fetch as unknown as (...args: unknown[]) => unknown);
    const storedSession = 'https://upload.youtube.test/session/already-complete';
    const clearResumableState = vi.fn().mockResolvedValue(undefined);
    let initPostCount = 0;
    let chunkPutCount = 0;

    fetchMock.mockImplementation(
      (url: unknown, options?: { method?: string; headers?: Record<string, string> }) => {
        const sUrl = String(url);
        const method = options?.method;
        const headers = options?.headers ?? {};

        if (method === 'POST' && sUrl.includes('/upload/youtube/v3/videos?uploadType=resumable')) {
          initPostCount += 1;
          return Promise.resolve(
            new Response(null, {
              status: 200,
              headers: { location: 'https://upload.youtube.test/session/new' },
            })
          );
        }

        if (
          method === 'PUT' &&
          sUrl === storedSession &&
          headers['Content-Range'] === 'bytes */512'
        ) {
          return Promise.resolve(
            new Response(JSON.stringify({ id: 'already-complete-video-id' }), { status: 200 })
          );
        }

        if (method === 'PUT' && sUrl === storedSession) {
          chunkPutCount += 1;
        }

        return Promise.resolve(new Response('', { status: 200 }));
      }
    );

    const result = await youtube.uploadToYouTube({
      videoStream: makeVideoStreamOfLength(512),
      contentLength: 512,
      contentType: 'video/mp4',
      metadata: BASE_UPLOAD_METADATA,
      tokens: { accessToken: 'tok' },
      resumableState: {
        resumableUploadUrl: storedSession,
        resumableBytesConfirmed: 512,
        resumableUpdatedAt: '2026-06-20T10:00:00.000Z',
      },
      clearResumableState,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.platformVideoId).toBe('already-complete-video-id');
    }
    expect(initPostCount).toBe(0);
    expect(chunkPutCount).toBe(0);
    expect(clearResumableState).toHaveBeenCalledTimes(1);
  });

  it('keeps the stored session and offset when the probe fails transiently', async () => {
    const fetchMock = vi.mocked(global.fetch as unknown as (...args: unknown[]) => unknown);
    const storedSession = 'https://upload.youtube.test/session/stored';
    const persistResumableState = vi.fn().mockResolvedValue(undefined);
    const clearResumableState = vi.fn().mockResolvedValue(undefined);
    let initPostCount = 0;

    fetchMock.mockImplementation(
      (url: unknown, options?: { method?: string; headers?: Record<string, string> }) => {
        const sUrl = String(url);
        const method = options?.method;
        const headers = options?.headers ?? {};

        if (method === 'POST' && sUrl.includes('/upload/youtube/v3/videos?uploadType=resumable')) {
          initPostCount += 1;
          return Promise.resolve(
            new Response(null, {
              status: 200,
              headers: { location: 'https://upload.youtube.test/session/new' },
            })
          );
        }

        if (
          method === 'PUT' &&
          sUrl === storedSession &&
          headers['Content-Range'] === 'bytes */512'
        ) {
          return Promise.reject(new TypeError('probe network blip'));
        }

        if (
          method === 'PUT' &&
          sUrl === storedSession &&
          headers['Content-Range'] === 'bytes 128-511/512'
        ) {
          return Promise.resolve(
            new Response(JSON.stringify({ id: 'probe-fallback-video-id' }), { status: 200 })
          );
        }

        return Promise.resolve(new Response('', { status: 200 }));
      }
    );

    const result = await youtube.uploadToYouTube({
      videoStream: makeVideoStreamOfLength(512),
      contentLength: 512,
      contentType: 'video/mp4',
      metadata: BASE_UPLOAD_METADATA,
      tokens: { accessToken: 'tok' },
      resumableState: {
        resumableUploadUrl: storedSession,
        resumableBytesConfirmed: 128,
        resumableUpdatedAt: '2026-06-20T10:00:00.000Z',
      },
      persistResumableState,
      clearResumableState,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.platformVideoId).toBe('probe-fallback-video-id');
    }
    expect(initPostCount).toBe(0);
    expect(clearResumableState).toHaveBeenCalledTimes(1);
  });
});

describe('probeYouTubeResumableSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns resume offset from a 308 Range response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 308, headers: { Range: 'bytes 0-255' } }))
    );

    await expect(
      youtube.probeYouTubeResumableSession({
        sessionUrl: 'https://upload.youtube.test/session/probe',
        accessToken: 'tok',
        totalBytes: 512,
        contentType: 'video/mp4',
      })
    ).resolves.toEqual({ status: 'resume', bytesConfirmed: 256 });
  });

  it('returns invalid for expired sessions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 410 }))
    );

    await expect(
      youtube.probeYouTubeResumableSession({
        sessionUrl: 'https://upload.youtube.test/session/gone',
        accessToken: 'tok',
        totalBytes: 512,
        contentType: 'video/mp4',
      })
    ).resolves.toEqual({ status: 'invalid' });
  });

  it('returns invalid for missing sessions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 }))
    );

    await expect(
      youtube.probeYouTubeResumableSession({
        sessionUrl: 'https://upload.youtube.test/session/missing',
        accessToken: 'tok',
        totalBytes: 512,
        contentType: 'video/mp4',
      })
    ).resolves.toEqual({ status: 'invalid' });
  });

  it('returns unconfirmed when the probe request fails transiently', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      })
    );

    await expect(
      youtube.probeYouTubeResumableSession({
        sessionUrl: 'https://upload.youtube.test/session/flaky',
        accessToken: 'tok',
        totalBytes: 512,
        contentType: 'video/mp4',
      })
    ).resolves.toEqual({ status: 'unconfirmed' });
  });

  it('returns unconfirmed after repeated 503 responses', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 }))
    );

    const probePromise = youtube.probeYouTubeResumableSession({
      sessionUrl: 'https://upload.youtube.test/session/overloaded',
      accessToken: 'tok',
      totalBytes: 512,
      contentType: 'video/mp4',
    });

    await vi.runAllTimersAsync();
    await expect(probePromise).resolves.toEqual({ status: 'unconfirmed' });
    vi.useRealTimers();
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
