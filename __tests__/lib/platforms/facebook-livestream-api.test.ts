/**
 * Tests for Facebook Live Video Graph API helpers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteFacebookLiveVideo,
  endFacebookLiveVideo,
} from '@/lib/platforms/facebook-livestream-api';

const ACCESS_TOKEN = 'page-access-token';
const LIVE_VIDEO_ID = '1412016960959699';

const mockFetch = vi.fn();

describe('deleteFacebookLiveVideo', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns success when DELETE succeeds on the first attempt', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });

    const result = await deleteFacebookLiveVideo(ACCESS_TOKEN, LIVE_VIDEO_ID);

    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE' });
  });

  it('ends the live video and retries DELETE when the first delete fails', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'Cannot delete while live.' } }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });

    const result = await deleteFacebookLiveVideo(ACCESS_TOKEN, LIVE_VIDEO_ID);

    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE' });
    expect(mockFetch.mock.calls[1]?.[1]).toMatchObject({ method: 'POST' });
    expect(mockFetch.mock.calls[2]?.[1]).toMatchObject({ method: 'DELETE' });
  });

  it('returns the direct delete error when end and retry both fail', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'Delete rejected.' } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => ({ error: { message: 'End failed.' } }),
      });

    const result = await deleteFacebookLiveVideo(ACCESS_TOKEN, LIVE_VIDEO_ID);

    expect(result).toEqual({ ok: false, details: 'Delete rejected.' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('endFacebookLiveVideo', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts end_live_video=true to the live video id', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });

    const result = await endFacebookLiveVideo(ACCESS_TOKEN, LIVE_VIDEO_ID);

    expect(result).toEqual({ ok: true });
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('end_live_video=true');
  });
});
