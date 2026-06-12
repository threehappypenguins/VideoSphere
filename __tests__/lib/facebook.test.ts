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
    expect(startUrl).toContain('/page-1/video_reels');
    expect(startUrl).toContain('upload_phase=START');

    const ruploadInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('rupload.facebook.com');
    expect(ruploadInit.headers).toMatchObject({
      Authorization: 'OAuth page-token',
      offset: '0',
      file_size: '3',
    });

    const finishUrl = String(fetchMock.mock.calls[2]?.[0]);
    expect(finishUrl).toContain('upload_phase=FINISH');
    expect(finishUrl).toContain('video_state=PUBLISHED');
    expect(finishUrl).toContain('title=My+Reel');
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
    const finishUrl = String(vi.mocked(fetch).mock.calls[2]?.[0]);
    expect(finishUrl).toContain('video_state=SCHEDULED');
    expect(finishUrl).toContain(`scheduled_publish_time=${scheduled}`);
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
});
