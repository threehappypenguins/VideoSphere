import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetObjectWebStream = vi.fn();

vi.mock('@/lib/r2', () => ({
  getObjectWebStream: (...args: unknown[]) => mockGetObjectWebStream(...args),
}));

import {
  uploadToFacebook,
  validateFacebookScheduledPublishTime,
  FACEBOOK_MIN_SCHEDULE_LEAD_SECONDS,
} from '@/lib/platforms/facebook';
import { MAX_DRAFT_THUMBNAIL_BYTES } from '@/lib/draft-thumbnail';
import type { ConnectedAccount } from '@/types';

describe('validateFacebookScheduledPublishTime', () => {
  const nowMs = 1_700_000_000_000;

  it('accepts timestamps within the allowed window', () => {
    const ts = Math.floor(nowMs / 1000) + FACEBOOK_MIN_SCHEDULE_LEAD_SECONDS + 60;
    expect(validateFacebookScheduledPublishTime(ts, nowMs)).toBeUndefined();
  });

  it('rejects timestamps too soon', () => {
    const ts = Math.floor(nowMs / 1000) + 60;
    expect(validateFacebookScheduledPublishTime(ts, nowMs)).toMatch(/10 minutes/);
  });
});

describe('uploadToFacebook', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    mockGetObjectWebStream.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeStream(): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
  }

  const connectedAccount: ConnectedAccount = {
    id: 'conn-1',
    userId: 'user-1',
    platform: 'facebook',
    tokenExpiry: '2099-01-01T00:00:00.000Z',
    hasRefreshToken: true,
    platformUserId: 'page-1',
    platformName: 'Test Page',
    facebookPageId: 'page-1',
    accessToken: 'page-token',
    refreshToken: 'user-token',
    $createdAt: '2000-01-01T00:00:00.000Z',
    $updatedAt: '2000-01-01T00:00:00.000Z',
  };

  it('publishes immediately via the three-step Reels flow', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ video_id: 'vid-123' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, post_id: 'post-1' }), { status: 200 })
      );

    const result = await uploadToFacebook({
      connectedAccount,
      videoStream: makeStream(),
      contentLength: 3,
      metadata: {
        title: 'My Reel',
        description: 'About the reel',
        tags: [],
        visibility: 'public',
      },
      tokens: { accessToken: 'page-token' },
    });

    expect(result).toEqual({
      ok: true,
      platformVideoId: 'vid-123',
      platformUrl: 'https://www.facebook.com/reel/vid-123',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const startUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(startUrl).toBe('https://graph.facebook.com/v25.0/page-1/video_reels');
    const startInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(String(startInit.body)).toContain('upload_phase=START');
    expect(String(startInit.body)).not.toContain('access_token');
    expect(new Headers(startInit.headers).get('Authorization')).toBe('Bearer page-token');

    const ruploadInit = fetchMock.mock.calls[1]?.[1] as RequestInit & { duplex?: string };
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('rupload.facebook.com');
    expect(ruploadInit.headers).toMatchObject({
      Authorization: 'OAuth page-token',
      offset: '0',
      file_size: '3',
    });
    expect(ruploadInit.body).toBeInstanceOf(ReadableStream);
    expect(ruploadInit.duplex).toBe('half');

    const finishUrl = String(fetchMock.mock.calls[2]?.[0]);
    expect(finishUrl).toBe('https://graph.facebook.com/v25.0/page-1/video_reels');
    const finishInit = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect(String(finishInit.body)).toContain('upload_phase=FINISH');
    expect(String(finishInit.body)).toContain('video_state=PUBLISHED');
    expect(String(finishInit.body)).toContain('title=My+Reel');
    expect(String(finishInit.body)).not.toContain('access_token');
    expect(new Headers(finishInit.headers).get('Authorization')).toBe('Bearer page-token');
  });

  it('uses upload_url from the START response when Meta provides one', async () => {
    const customUploadUrl = 'https://rupload.facebook.com/video-upload/v25.0/vid-123?sig=abc';
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ video_id: 'vid-123', upload_url: customUploadUrl }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

    const result = await uploadToFacebook({
      connectedAccount,
      videoStream: makeStream(),
      contentLength: 3,
      metadata: {
        title: 'My Reel',
        description: '',
        tags: [],
        visibility: 'public',
      },
      tokens: { accessToken: 'page-token' },
    });

    expect(result.ok).toBe(true);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(customUploadUrl);
  });

  it('falls back to the default rupload URL when upload_url is untrusted', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            video_id: 'vid-123',
            upload_url: 'https://evil.example/upload',
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

    await uploadToFacebook({
      connectedAccount,
      videoStream: makeStream(),
      contentLength: 3,
      metadata: {
        title: 'My Reel',
        description: '',
        tags: [],
        visibility: 'public',
      },
      tokens: { accessToken: 'page-token' },
    });

    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'https://rupload.facebook.com/video-upload/v25.0/vid-123'
    );
  });

  it('falls back when upload_url is on rupload host but has an unexpected path', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            video_id: 'vid-123',
            upload_url: 'https://rupload.facebook.com/other-endpoint/vid-123',
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

    await uploadToFacebook({
      connectedAccount,
      videoStream: makeStream(),
      contentLength: 3,
      metadata: {
        title: 'My Reel',
        description: '',
        tags: [],
        visibility: 'public',
      },
      tokens: { accessToken: 'page-token' },
    });

    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'https://rupload.facebook.com/video-upload/v25.0/vid-123'
    );
  });

  it('sends scheduled_publish_time when video state is SCHEDULED', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const scheduled = nowSec + FACEBOOK_MIN_SCHEDULE_LEAD_SECONDS + 3600;

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ video_id: 'vid-sched' }), { status: 200 })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

    const result = await uploadToFacebook({
      connectedAccount,
      videoStream: makeStream(),
      contentLength: 3,
      metadata: {
        title: 'Scheduled',
        description: '',
        tags: [],
        visibility: 'public',
        facebookVideoState: 'SCHEDULED',
        facebookScheduledPublishTime: scheduled,
      },
      tokens: { accessToken: 'page-token' },
    });

    expect(result.ok).toBe(true);
    const finishInit = vi.mocked(fetch).mock.calls[2]?.[1] as RequestInit;
    expect(String(finishInit.body)).toContain('video_state=SCHEDULED');
    expect(String(finishInit.body)).toContain(`scheduled_publish_time=${scheduled}`);
  });

  it('returns a clear error when scheduled time is too soon', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const result = await uploadToFacebook({
      connectedAccount,
      videoStream: makeStream(),
      contentLength: 3,
      metadata: {
        title: 'Late',
        description: '',
        tags: [],
        visibility: 'public',
        facebookVideoState: 'SCHEDULED',
        facebookScheduledPublishTime: nowSec + 60,
      },
      tokens: { accessToken: 'page-token' },
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'FACEBOOK_SCHEDULE_TIME_INVALID',
        message: expect.stringMatching(/10 minutes/),
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns a clear error when the connection targets a personal profile', async () => {
    const result = await uploadToFacebook({
      connectedAccount: {
        ...connectedAccount,
        facebookTargetType: 'profile',
        facebookPageId: undefined,
        platformUserId: 'user-profile-1',
        platformName: 'Personal Profile',
      },
      videoStream: makeStream(),
      contentLength: 3,
      metadata: {
        title: 'My Reel',
        description: '',
        tags: [],
        visibility: 'public',
      },
      tokens: { accessToken: 'user-token' },
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'FACEBOOK_PAGE_CONNECTION_REQUIRED',
        message: expect.stringMatching(/Facebook Page/i),
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not fall back to platformUserId when facebookPageId is missing', async () => {
    const result = await uploadToFacebook({
      connectedAccount: {
        ...connectedAccount,
        facebookTargetType: 'page',
        facebookPageId: undefined,
        platformUserId: 'page-1',
      },
      videoStream: makeStream(),
      contentLength: 3,
      metadata: {
        title: 'My Reel',
        description: '',
        tags: [],
        visibility: 'public',
      },
      tokens: { accessToken: 'page-token' },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'FACEBOOK_PAGE_CONNECTION_REQUIRED' },
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('uploadToFacebook thumbnail path', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    mockGetObjectWebStream.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const connectedAccount: ConnectedAccount = {
    id: 'conn-1',
    userId: 'user-1',
    platform: 'facebook',
    tokenExpiry: '2099-01-01T00:00:00.000Z',
    hasRefreshToken: true,
    platformUserId: 'page-1',
    platformName: 'Test Page',
    facebookPageId: 'page-1',
    accessToken: 'page-token',
    refreshToken: 'user-token',
    $createdAt: '2000-01-01T00:00:00.000Z',
    $updatedAt: '2000-01-01T00:00:00.000Z',
  };

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
        controller.enqueue(new Uint8Array([4, 5, 6, 7]));
        controller.close();
      },
    });
  }

  it('uploads a custom thumbnail from R2 after successful Reels publish', async () => {
    const fetchMock = vi.mocked(fetch);
    mockGetObjectWebStream.mockResolvedValue({
      stream: makeThumbnailStream(),
      contentLength: 4,
      contentType: 'image/jpeg',
    });

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ video_id: 'vid-123' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

    const result = await uploadToFacebook({
      connectedAccount,
      videoStream: makeVideoStream(),
      contentLength: 3,
      metadata: {
        title: 'My Reel',
        description: '',
        tags: [],
        visibility: 'public',
        thumbnailR2Key: 'draft-thumbnails/user/thumb.jpg',
        thumbnailContentType: 'image/jpeg',
      },
      tokens: { accessToken: 'page-token' },
    });

    expect(result).toEqual({
      ok: true,
      platformVideoId: 'vid-123',
      platformUrl: 'https://www.facebook.com/reel/vid-123',
    });
    expect(mockGetObjectWebStream).toHaveBeenCalledWith('draft-thumbnails/user/thumb.jpg', {
      signal: undefined,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[3]?.[0])).toBe(
      'https://graph.facebook.com/v25.0/vid-123/thumbnails'
    );
    const thumbInit = fetchMock.mock.calls[3]?.[1] as RequestInit;
    expect(thumbInit.method).toBe('POST');
    expect(new Headers(thumbInit.headers).get('Authorization')).toBe('Bearer page-token');
    expect(thumbInit.body).toBeInstanceOf(FormData);
  });

  it('uses R2 content-type as fallback when thumbnailContentType is absent', async () => {
    const fetchMock = vi.mocked(fetch);
    mockGetObjectWebStream.mockResolvedValue({
      stream: makeThumbnailStream(),
      contentLength: 4,
      contentType: 'image/png',
    });

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ video_id: 'vid-123' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

    const result = await uploadToFacebook({
      connectedAccount,
      videoStream: makeVideoStream(),
      contentLength: 3,
      metadata: {
        title: 'My Reel',
        description: '',
        tags: [],
        visibility: 'public',
        thumbnailR2Key: 'draft-thumbnails/user/thumb.png',
        thumbnailContentType: undefined,
      },
      tokens: { accessToken: 'page-token' },
    });

    expect(result.ok).toBe(true);
    const form = (fetchMock.mock.calls[3]?.[1] as RequestInit).body as FormData;
    const source = form.get('source') as Blob;
    expect(source.type).toBe('image/png');
  });

  it('still returns ok when thumbnail upload fails with non-2xx', async () => {
    const fetchMock = vi.mocked(fetch);
    mockGetObjectWebStream.mockResolvedValue({
      stream: makeThumbnailStream(),
      contentLength: 4,
      contentType: 'image/png',
    });

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ video_id: 'vid-123' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response('thumbnail rejected', { status: 400 }));

    const result = await uploadToFacebook({
      connectedAccount,
      videoStream: makeVideoStream(),
      contentLength: 3,
      metadata: {
        title: 'My Reel',
        description: '',
        tags: [],
        visibility: 'public',
        thumbnailR2Key: 'draft-thumbnails/user/thumb.png',
        thumbnailContentType: 'image/png',
      },
      tokens: { accessToken: 'page-token' },
    });

    expect(result).toEqual({
      ok: true,
      platformVideoId: 'vid-123',
      platformUrl: 'https://www.facebook.com/reel/vid-123',
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('skips thumbnail upload when the R2 object exceeds the max size', async () => {
    const fetchMock = vi.mocked(fetch);
    const cancel = vi.fn().mockResolvedValue(undefined);
    mockGetObjectWebStream.mockResolvedValue({
      stream: { cancel } as unknown as ReadableStream<Uint8Array>,
      contentLength: MAX_DRAFT_THUMBNAIL_BYTES + 1,
      contentType: 'image/jpeg',
    });

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ video_id: 'vid-123' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

    const result = await uploadToFacebook({
      connectedAccount,
      videoStream: makeVideoStream(),
      contentLength: 3,
      metadata: {
        title: 'My Reel',
        description: '',
        tags: [],
        visibility: 'public',
        thumbnailR2Key: 'draft-thumbnails/user/huge.jpg',
        thumbnailContentType: 'image/jpeg',
      },
      tokens: { accessToken: 'page-token' },
    });

    expect(result.ok).toBe(true);
    expect(cancel).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/thumbnails'))).toBe(
      false
    );
  });
});
