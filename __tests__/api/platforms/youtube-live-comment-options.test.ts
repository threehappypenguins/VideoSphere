import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedUserId = vi.fn();
const mockGetConnectedAccountWithTokens = vi.fn();
const mockRefreshTokenIfNeeded = vi.fn();
const mockFetchYouTubeLiveCommentDefaults = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

vi.mock('@/lib/repositories/connected-accounts', () => ({
  getConnectedAccountWithTokens: (...args: unknown[]) => mockGetConnectedAccountWithTokens(...args),
}));

vi.mock('@/lib/platforms/token-refresh', () => ({
  refreshTokenIfNeeded: (...args: unknown[]) => mockRefreshTokenIfNeeded(...args),
}));

vi.mock('@/lib/platforms/youtube-livestream-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/platforms/youtube-livestream-api')>();
  return {
    ...actual,
    fetchYouTubeLiveCommentDefaults: (...args: unknown[]) =>
      mockFetchYouTubeLiveCommentDefaults(...args),
  };
});

import { GET } from '@/app/api/platforms/youtube/live-comment-options/route';

const YOUTUBE_ACCOUNT = {
  id: 'acc-yt-1',
  userId: 'user-123',
  platform: 'youtube' as const,
  accessToken: 'stored-access-token',
  refreshToken: 'stored-refresh-token',
  tokenExpiry: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  hasRefreshToken: true,
  hasYoutubeMainStreamKey: false,
  hasYoutubeTempStreamKey: false,
  platformUserId: 'channel-1',
  platformName: 'My Channel',
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/platforms/youtube/live-comment-options', {
    method: 'GET',
  });
}

describe('GET /api/platforms/youtube/live-comment-options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedUserId.mockResolvedValue('user-123');
    mockGetConnectedAccountWithTokens.mockResolvedValue(YOUTUBE_ACCOUNT);
    mockRefreshTokenIfNeeded.mockResolvedValue({
      accessToken: 'yt-access-token',
      refreshToken: 'stored-refresh-token',
      tokenExpiry: YOUTUBE_ACCOUNT.tokenExpiry,
    });
    mockFetchYouTubeLiveCommentDefaults.mockResolvedValue({
      ok: true,
      defaults: {
        showViewerLikeCount: false,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 401 when the user is not authenticated', async () => {
    mockGetAuthenticatedUserId.mockResolvedValueOnce(null);

    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockFetchYouTubeLiveCommentDefaults).not.toHaveBeenCalled();
  });

  it('returns comment defaults from YouTube', async () => {
    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: {
        showViewerLikeCount: false,
      },
    });
    expect(mockFetchYouTubeLiveCommentDefaults).toHaveBeenCalledWith(
      'yt-access-token',
      expect.any(AbortSignal)
    );
  });

  it('returns 502 when YouTube upstream fetch fails', async () => {
    mockFetchYouTubeLiveCommentDefaults.mockResolvedValueOnce({
      ok: false,
      details: 'Forbidden',
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(502);
  });
});
