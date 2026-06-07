import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  pollSermonAudioProcessing,
  publishSermonAudio,
  uploadToSermonAudio,
} from '@/lib/platforms/sermon-audio';
import type { PlatformUploadMetadata, PlatformUploadTokens } from '@/lib/platforms/types';

function makeVideoStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
}

const tokens: PlatformUploadTokens = {
  accessToken: 'sa-api-key',
  refreshToken: '',
};

const metadata: PlatformUploadMetadata = {
  title: 'Sunday Sermon',
  description: 'A message on faith.',
  tags: ['faith', 'hope'],
  visibility: 'public',
  fullTitle: 'Sunday Sermon',
  speakerName: 'Rev. Smith',
  preachDate: '2026-06-01',
};

describe('uploadToSermonAudio', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates sermon, media upload, and streams video on success', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sermonID: 'sermon-123' }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ uploadURL: 'https://upload.sermonaudio.test/video' }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    const result = await uploadToSermonAudio({
      videoStream: makeVideoStream(),
      contentLength: 3,
      contentType: 'video/mp4',
      metadata,
      tokens,
    });

    expect(result).toEqual({
      ok: true,
      platformVideoId: 'sermon-123',
      platformUrl: 'https://www.sermonaudio.com/sermons/sermon-123',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.sermonaudio.com/v2/node/sermons');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.sermonaudio.com/v2/media');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('https://upload.sermonaudio.test/video');
  });

  it('includes speakerID in create sermon body when provided', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sermonID: 'sermon-456' }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ uploadURL: 'https://upload.sermonaudio.test/video' }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    await uploadToSermonAudio({
      videoStream: makeVideoStream(),
      contentLength: 3,
      metadata: { ...metadata, speakerID: 99 },
      tokens,
    });

    const createInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const createBody = JSON.parse(String(createInit.body)) as Record<string, unknown>;
    expect(createBody).toMatchObject({ speakerID: 99 });
    expect(createBody).not.toHaveProperty('speakerName');
  });

  it('omits non-positive speakerID and falls back to speakerName when provided', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sermonID: 'sermon-456' }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ uploadURL: 'https://upload.sermonaudio.test/video' }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    await uploadToSermonAudio({
      videoStream: makeVideoStream(),
      contentLength: 3,
      metadata: { ...metadata, speakerID: 0, speakerName: 'Rev. Smith' },
      tokens,
    });

    const createInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const createBody = JSON.parse(String(createInit.body)) as Record<string, unknown>;
    expect(createBody).not.toHaveProperty('speakerID');
    expect(createBody).toMatchObject({ speakerName: 'Rev. Smith' });
  });

  it('includes socialSharing on sermon create when Cross Publish is enabled', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sermonID: 'sermon-456' }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ uploadURL: 'https://upload.sermonaudio.test/video' }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    await uploadToSermonAudio({
      videoStream: makeVideoStream(),
      contentLength: 3,
      metadata: {
        ...metadata,
        crossPublish: {
          enabled: true,
          youtube: { uploadFullVideo: true, title: 'YT Title', description: 'YT Desc' },
          facebook: { postLink: true, linkMessage: 'Check this out' },
          x: { uploadVideoPreview: true },
        },
      },
      tokens,
    });

    const createInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const createBody = JSON.parse(String(createInit.body)) as Record<string, unknown>;
    expect(createBody.socialSharing).toEqual([
      { platform: 'google', title: 'YT Title', message: 'YT Desc', privacy: 'public' },
      { platform: 'facebook', message: 'Check this out' },
      { platform: 'twitter', message: 'Sunday Sermon', useVideoClip: true },
    ]);
    expect(createBody.social_sharing_video_clip).toEqual({ start: 0, end: 120 });
  });

  it('does not include socialSharing on sermon create when Cross Publish is disabled', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sermonID: 'sermon-456' }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ uploadURL: 'https://upload.sermonaudio.test/video' }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    await uploadToSermonAudio({
      videoStream: makeVideoStream(),
      contentLength: 3,
      metadata: {
        ...metadata,
        crossPublish: {
          enabled: false,
          facebook: { postLink: true, linkMessage: 'Check this out' },
        },
      },
      tokens,
    });

    const createInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const createBody = JSON.parse(String(createInit.body)) as Record<string, unknown>;
    expect(createBody).not.toHaveProperty('socialSharing');
    expect(createBody).not.toHaveProperty('social_sharing_video_clip');
  });

  it('includes seriesID in create sermon body when provided', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sermonID: 'sermon-789' }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ uploadURL: 'https://upload.sermonaudio.test/video' }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    await uploadToSermonAudio({
      videoStream: makeVideoStream(),
      contentLength: 3,
      metadata: { ...metadata, subtitle: 'Romans', seriesID: 55 },
      tokens,
    });

    const createInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const createBody = JSON.parse(String(createInit.body)) as Record<string, unknown>;
    expect(createBody).toMatchObject({ seriesID: 55 });
    expect(createBody).not.toHaveProperty('subtitle');
  });

  it('omits non-positive seriesID and falls back to subtitle when provided', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sermonID: 'sermon-789' }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ uploadURL: 'https://upload.sermonaudio.test/video' }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    await uploadToSermonAudio({
      videoStream: makeVideoStream(),
      contentLength: 3,
      metadata: { ...metadata, subtitle: 'Romans', seriesID: 0 },
      tokens,
    });

    const createInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const createBody = JSON.parse(String(createInit.body)) as Record<string, unknown>;
    expect(createBody).not.toHaveProperty('seriesID');
    expect(createBody).toMatchObject({ subtitle: 'Romans' });
  });

  it('returns an error when the API key is missing', async () => {
    const result = await uploadToSermonAudio({
      videoStream: makeVideoStream(),
      contentLength: 3,
      metadata,
      tokens: { accessToken: '  ', refreshToken: '' },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'SERMONAUDIO_API_KEY_MISSING' },
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('pollSermonAudioProcessing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('resolves when any media.video entry has a thumbnailImageURL', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          media: {
            video: [
              {
                videoCodec: 'h264',
                adaptiveBitrate: false,
                thumbnailImageURL: 'https://media.sermonaudio.com/thumbnails/662635113143.jpg',
              },
            ],
          },
        }),
        { status: 200 }
      )
    );

    await expect(
      pollSermonAudioProcessing({
        sermonID: 'sermon-123',
        tokens,
        intervalMs: 1000,
        maxAttempts: 3,
      })
    ).resolves.toBeUndefined();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.sermonaudio.com/v2/node/sermons/sermon-123?allowUnpublished=true',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ 'X-Api-Key': 'sa-api-key' }),
      })
    );
  });

  it('resolves when the ABR video entry has a thumbnail before progressive renditions expose codecs', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          videoMediaStatus: 'ready',
          media: {
            video: [
              {
                mediaType: 'mp4',
                streamURL: 'https://cloud.sermonaudio.com/media/video/abr/662635113143.m3u8',
                thumbnailImageURL: 'https://media.sermonaudio.com/thumbnails/662635113143.jpg',
                adaptiveBitrate: true,
                videoCodec: null,
              },
              {
                mediaType: 'mp4',
                streamURL: 'https://cloud.sermonaudio.com/media/video/high/662635113143.m3u8',
                thumbnailImageURL: 'https://media.sermonaudio.com/thumbnails/662635113143.jpg',
                adaptiveBitrate: false,
                videoCodec: 'h264',
              },
            ],
          },
        }),
        { status: 200 }
      )
    );

    await expect(
      pollSermonAudioProcessing({
        sermonID: 'sermon-123',
        tokens,
        intervalMs: 1000,
        maxAttempts: 3,
      })
    ).resolves.toBeUndefined();
  });

  it('keeps polling when video renditions exist but thumbnailImageURL is still null', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          videoMediaStatus: 'ready',
          media: {
            video: [{ videoCodec: 'h264', adaptiveBitrate: false, thumbnailImageURL: null }],
          },
        }),
        { status: 200 }
      )
    );

    const promise = pollSermonAudioProcessing({
      sermonID: 'sermon-123',
      tokens,
      intervalMs: 100,
      maxAttempts: 2,
    });

    const expectation = expect(promise).rejects.toMatchObject({
      code: 'SERMONAUDIO_PROCESSING_TIMEOUT',
    });
    await vi.runAllTimersAsync();
    await expectation;
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects when max attempts are exceeded without a video thumbnail', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          media: {
            video: [{ videoCodec: 'h264', adaptiveBitrate: false, thumbnailImageURL: null }],
          },
        }),
        { status: 200 }
      )
    );

    const promise = pollSermonAudioProcessing({
      sermonID: 'sermon-123',
      tokens,
      intervalMs: 100,
      maxAttempts: 2,
    });

    const expectation = expect(promise).rejects.toMatchObject({
      code: 'SERMONAUDIO_PROCESSING_TIMEOUT',
    });
    await vi.runAllTimersAsync();
    await expectation;
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects when the abort signal fires during polling', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ media: { video: [] } }), { status: 200 })
    );

    const controller = new AbortController();
    const promise = pollSermonAudioProcessing({
      sermonID: 'sermon-123',
      tokens,
      intervalMs: 5000,
      maxAttempts: 5,
      signal: controller.signal,
    });

    await Promise.resolve();
    controller.abort(new Error('Polling aborted'));
    const expectation = expect(promise).rejects.toThrow('Polling aborted');
    await vi.advanceTimersByTimeAsync(5000);
    await expectation;
  });
});

describe('publishSermonAudio', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-05T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('PATCHes publishDate only on success (Cross Publish is configured on sermon create)', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response('', { status: 200 }));

    await publishSermonAudio({
      sermonID: 'sermon-123',
      tokens,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.sermonaudio.com/v2/node/sermons/sermon-123',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({ 'X-Api-Key': 'sa-api-key' }),
        body: JSON.stringify({ publishDate: '2026-06-05' }),
      })
    );
  });

  it('throws when publish request fails', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response('Server error', { status: 500 }));

    await expect(
      publishSermonAudio({
        sermonID: 'sermon-123',
        tokens,
      })
    ).rejects.toMatchObject({
      code: 'SERMONAUDIO_PUBLISH_FAILED',
      statusCode: 500,
    });
  });
});
