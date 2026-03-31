import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetObjectWebStream = vi.fn();

vi.mock('@/lib/r2', () => ({
  getObjectWebStream: (...args: unknown[]) => mockGetObjectWebStream(...args),
}));

import * as vimeo from '@/lib/platforms/vimeo';

describe('buildVimeoCategorySuggestBatchBody', () => {
  it('parses /categories/{slug} into Vimeo batch format', () => {
    expect(vimeo.buildVimeoCategorySuggestBatchBody('/categories/animation')).toEqual([
      { category: 'animation' },
    ]);
  });

  it('parses plain slug', () => {
    expect(vimeo.buildVimeoCategorySuggestBatchBody('music')).toEqual([{ category: 'music' }]);
  });

  it('parses subcategory path as two batch entries', () => {
    expect(
      vimeo.buildVimeoCategorySuggestBatchBody('/categories/animation/subcategories/2d')
    ).toEqual([{ category: 'animation' }, { category: '2d' }]);
  });

  it('parses https://vimeo.com/categories/...', () => {
    expect(
      vimeo.buildVimeoCategorySuggestBatchBody('https://vimeo.com/categories/documentary')
    ).toEqual([{ category: 'documentary' }]);
  });

  it('returns null for unrecognizable strings', () => {
    expect(vimeo.buildVimeoCategorySuggestBatchBody('')).toBeNull();
    expect(vimeo.buildVimeoCategorySuggestBatchBody('   ')).toBeNull();
    expect(vimeo.buildVimeoCategorySuggestBatchBody('/foo/bar')).toBeNull();
  });
});

describe('waitUntilVimeoUploadAndTranscodeComplete', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('resolves when upload and transcode are complete', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ upload: { status: 'complete' }, transcode: { status: 'complete' } }),
        { status: 200 }
      )
    );

    await expect(
      vimeo.waitUntilVimeoUploadAndTranscodeComplete('videos/1', 'tok', {
        deadlineMs: 5_000,
        pollIntervalMs: 10,
      })
    ).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries after non-2xx status probe then completes', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ upload: { status: 'complete' }, transcode: { status: 'complete' } }),
          { status: 200 }
        )
      );

    const p = vimeo.waitUntilVimeoUploadAndTranscodeComplete('videos/1', 'tok', {
      deadlineMs: 120_000,
      pollIntervalMs: 10,
    });
    const settled = expect(p).resolves.toBeUndefined();
    await vi.runAllTimersAsync();
    await settled;
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects when upload.status is error', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ upload: { status: 'error' }, reason: 'x' }), { status: 200 })
    );

    await expect(
      vimeo.waitUntilVimeoUploadAndTranscodeComplete('videos/1', 'tok', {
        deadlineMs: 5_000,
        pollIntervalMs: 10,
      })
    ).rejects.toThrow(/upload\.status error/i);
  });

  it('rejects when transcode.status is error', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          upload: { status: 'complete' },
          transcode: { status: 'error' },
        }),
        { status: 200 }
      )
    );

    await expect(
      vimeo.waitUntilVimeoUploadAndTranscodeComplete('videos/1', 'tok', {
        deadlineMs: 5_000,
        pollIntervalMs: 10,
      })
    ).rejects.toThrow(/transcode\.status error/i);
  });

  it('rejects on timeout when ingest never finishes', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            upload: { status: 'in_progress' },
            transcode: { status: 'in_progress' },
          }),
          { status: 200 }
        )
      )
    );

    const p = vimeo.waitUntilVimeoUploadAndTranscodeComplete('videos/1', 'tok', {
      deadlineMs: 80,
      pollIntervalMs: 10,
    });
    const settled = expect(p).rejects.toThrow(/Timed out waiting for Vimeo upload and transcode/);
    await vi.runAllTimersAsync();
    await settled;
  });
});

describe('uploadToVimeo', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    mockGetObjectWebStream.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function makeStream(): ReadableStream<Uint8Array> {
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

  it('uploads and activates a Vimeo thumbnail from R2', async () => {
    const fetchMock = vi.mocked(global.fetch as unknown as (...args: any[]) => any);

    const uploadLink = 'https://tus.example/upload';
    const videoUri = 'https://api.vimeo.com/videos/99999';
    const pictureUploadLink = 'https://i.vimeocdn.com/custom-thumbnail-upload';
    const pictureUri = '/videos/99999/pictures/1234567';

    mockGetObjectWebStream.mockResolvedValue({
      stream: makeThumbnailStream(),
      contentLength: 4,
      contentType: 'image/webp',
    });

    fetchMock.mockImplementation((url: unknown, options?: any) => {
      const method = options?.method;
      const sUrl = String(url);

      if (method === 'POST' && sUrl.includes('me/videos')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              upload: { upload_link: uploadLink },
              uri: videoUri,
            }),
            { status: 201 }
          )
        );
      }

      if (method === 'PATCH' && sUrl === uploadLink) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }

      if (method === 'HEAD' && sUrl === uploadLink) {
        return Promise.resolve(new Response('', { status: 200 }));
      }

      if (method === 'POST' && sUrl.includes('/videos/99999/pictures')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              uri: pictureUri,
              link: pictureUploadLink,
            }),
            { status: 201 }
          )
        );
      }

      if (method === 'PUT' && sUrl === pictureUploadLink) {
        return Promise.resolve(new Response('', { status: 200 }));
      }

      if (method === 'PATCH' && sUrl === 'https://api.vimeo.com/videos/99999/pictures/1234567') {
        return Promise.resolve(new Response(null, { status: 204 }));
      }

      return Promise.resolve(new Response('', { status: 200 }));
    });

    const result = await vimeo.uploadToVimeo({
      videoStream: makeStream(),
      contentLength: 3,
      contentType: 'video/mp4',
      metadata: {
        title: 'thumbnail test',
        description: 'with thumbnail',
        tags: [],
        visibility: 'public',
        thumbnailR2Key: 'drafts/draft-1/thumbnail.webp',
        thumbnailContentType: 'image/webp',
      },
      tokens: { accessToken: 'tok' },
    });

    expect(result.ok).toBe(true);
    expect(mockGetObjectWebStream).toHaveBeenCalledWith('drafts/draft-1/thumbnail.webp', {
      signal: undefined,
    });
  });

  it('fails when thumbnail activation retries are exhausted', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.mocked(global.fetch as unknown as (...args: any[]) => any);

    const uploadLink = 'https://tus.example/upload';
    const videoUri = 'https://api.vimeo.com/videos/11111';
    const pictureUploadLink = 'https://i.vimeocdn.com/custom-thumbnail-upload-2';
    const pictureUri = '/videos/11111/pictures/7654321';

    mockGetObjectWebStream.mockResolvedValue({
      stream: makeThumbnailStream(),
      contentLength: 4,
      contentType: 'image/png',
    });

    fetchMock.mockImplementation((url: unknown, options?: any) => {
      const method = options?.method;
      const sUrl = String(url);

      if (method === 'POST' && sUrl.includes('me/videos')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              upload: { upload_link: uploadLink },
              uri: videoUri,
            }),
            { status: 201 }
          )
        );
      }

      if (method === 'PATCH' && sUrl === uploadLink) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }

      if (method === 'HEAD' && sUrl === uploadLink) {
        return Promise.resolve(new Response('', { status: 200 }));
      }

      if (method === 'POST' && sUrl.includes('/videos/11111/pictures')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              uri: pictureUri,
              link: pictureUploadLink,
            }),
            { status: 201 }
          )
        );
      }

      if (method === 'PUT' && sUrl === pictureUploadLink) {
        return Promise.resolve(new Response('', { status: 200 }));
      }

      if (method === 'PATCH' && sUrl === 'https://api.vimeo.com/videos/11111/pictures/7654321') {
        return Promise.resolve(new Response('still processing', { status: 503 }));
      }

      return Promise.resolve(new Response('', { status: 200 }));
    });

    const uploadPromise = vimeo.uploadToVimeo({
      videoStream: makeStream(),
      contentLength: 3,
      contentType: 'video/mp4',
      metadata: {
        title: 'thumbnail activation fails',
        description: 'retry exhaustion',
        tags: [],
        visibility: 'public',
        thumbnailR2Key: 'drafts/draft-2/thumbnail.png',
      },
      tokens: { accessToken: 'tok' },
    });

    await vi.runAllTimersAsync();
    const result = await uploadPromise;

    expect(result.ok).toBe(false);
    const err = (result as { ok: false; error: { code: string; statusCode?: number } }).error;
    expect(err.code).toBe('VIMEO_THUMBNAIL_ACTIVATE_FAILED');
    expect(err.statusCode).toBe(503);
  });

  it('does not mask likely network errors while required tags are not applied', async () => {
    const fetchMock = vi.mocked(global.fetch as unknown as (...args: any[]) => any);

    const uploadLink = 'https://tus.example/upload';
    const videoUri = 'https://api.vimeo.com/videos/12345';

    fetchMock.mockImplementation((url: unknown, options?: any) => {
      const method = options?.method;
      const sUrl = String(url);

      if (sUrl.includes('fields=upload.status,transcode.status')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ upload: { status: 'complete' }, transcode: { status: 'complete' } }),
            { status: 200 }
          )
        );
      }

      if (method === 'POST' && sUrl.includes('me/videos')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              upload: { upload_link: uploadLink },
              uri: videoUri,
            }),
            { status: 201 }
          )
        );
      }

      if (method === 'PATCH') {
        return Promise.resolve(new Response('', { status: 204 }));
      }

      if (method === 'HEAD') {
        return Promise.resolve(new Response('', { status: 200 }));
      }

      if (method === 'PUT' && sUrl.includes('/tags')) {
        return Promise.reject(new Error('Network fetch failed'));
      }

      return Promise.resolve(new Response('', { status: 200 }));
    });

    const result = await vimeo.uploadToVimeo({
      videoStream: makeStream(),
      contentLength: 3,
      contentType: 'video/mp4',
      metadata: {
        title: 't',
        description: 'd',
        tags: ['tag1'],
        visibility: 'public',
      },
      tokens: { accessToken: 'tok' },
    });

    expect(result.ok).toBe(false);
    const err1 = (result as { ok: false; error: { code: string } }).error;
    expect(err1.code).toBe('VIMEO_UPLOAD_ERROR');
  });

  it('does not mask likely network errors while required category is not applied', async () => {
    const fetchMock = vi.mocked(global.fetch as unknown as (...args: any[]) => any);

    const uploadLink = 'https://tus.example/upload';
    const videoUri = 'https://api.vimeo.com/videos/67890';

    fetchMock.mockImplementation((url: unknown, options?: any) => {
      const method = options?.method;
      const sUrl = String(url);

      if (sUrl.includes('fields=upload.status,transcode.status')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ upload: { status: 'complete' }, transcode: { status: 'complete' } }),
            { status: 200 }
          )
        );
      }

      if (method === 'POST' && sUrl.includes('me/videos')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              upload: { upload_link: uploadLink },
              uri: videoUri,
            }),
            { status: 201 }
          )
        );
      }

      if (method === 'PATCH') {
        return Promise.resolve(new Response('', { status: 204 }));
      }

      if (method === 'HEAD') {
        return Promise.resolve(new Response('', { status: 200 }));
      }

      if (method === 'PUT' && sUrl.includes('/categories')) {
        return Promise.reject(new Error('Network fetch failed'));
      }

      return Promise.resolve(new Response('', { status: 200 }));
    });

    const result = await vimeo.uploadToVimeo({
      videoStream: makeStream(),
      contentLength: 3,
      contentType: 'video/mp4',
      metadata: {
        title: 't',
        description: 'd',
        tags: [],
        visibility: 'public',
        vimeoCategoryUri: 'animation',
      },
      tokens: { accessToken: 'tok' },
    });

    expect(result.ok).toBe(false);
    const err2 = (result as { ok: false; error: { code: string } }).error;
    expect(err2.code).toBe('VIMEO_UPLOAD_ERROR');
  });
});
