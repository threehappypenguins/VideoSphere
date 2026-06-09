import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedUserId = vi.fn();
const mockGetConnectedAccountWithTokens = vi.fn();
const mockRefreshTokenIfNeeded = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

vi.mock('@/lib/repositories/connected-accounts', () => ({
  getConnectedAccountWithTokens: (...args: unknown[]) => mockGetConnectedAccountWithTokens(...args),
}));

vi.mock('@/lib/platforms/token-refresh', () => ({
  refreshTokenIfNeeded: (...args: unknown[]) => mockRefreshTokenIfNeeded(...args),
}));

import { GET } from '@/app/api/platforms/youtube/playlists/recent/route';

const YOUTUBE_ACCOUNT = {
  id: 'acc-yt-1',
  userId: 'user-123',
  platform: 'youtube' as const,
  accessToken: 'stored-access-token',
  refreshToken: 'stored-refresh-token',
  tokenExpiry: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  platformUserId: 'channel-1',
  platformName: 'My Channel',
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/platforms/youtube/playlists/recent', {
    method: 'GET',
  });
}

describe('GET /api/platforms/youtube/playlists/recent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedUserId.mockResolvedValue('user-123');
    mockGetConnectedAccountWithTokens.mockResolvedValue(YOUTUBE_ACCOUNT);
    mockRefreshTokenIfNeeded.mockResolvedValue({
      accessToken: 'yt-access-token',
      refreshToken: 'stored-refresh-token',
      tokenExpiry: YOUTUBE_ACCOUNT.tokenExpiry,
    });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 401 when the user is not authenticated', async () => {
    mockGetAuthenticatedUserId.mockResolvedValueOnce(null);

    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: 'Unauthorized',
      message: 'Not authenticated',
      statusCode: 401,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns 401 when YouTube is not connected', async () => {
    mockGetConnectedAccountWithTokens.mockResolvedValueOnce(null);

    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: 'Unauthorized',
      message: 'YouTube is not connected',
      statusCode: 401,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns 401 when token refresh fails', async () => {
    mockRefreshTokenIfNeeded.mockRejectedValueOnce(
      new Error('YOUTUBE_TOKEN_REFRESH_FAILED: Refresh token revoked')
    );

    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.statusCode).toBe(401);
    expect(body.message).toContain('Refresh token revoked');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('paginates through all playlist pages and returns id/title rows', async () => {
    vi.mocked(global.fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('pageToken=page-2')) {
        return new Response(
          JSON.stringify({
            items: [{ id: 'PL3', snippet: { title: 'Third Playlist' } }],
          }),
          { status: 200 }
        );
      }

      if (url.includes('/youtube/v3/playlists')) {
        expect(url).toContain('mine=true');
        expect(url).toContain('maxResults=50');
        return new Response(
          JSON.stringify({
            items: [
              { id: 'PL1', snippet: { title: 'First Playlist' } },
              { id: 'PL2', snippet: { title: 'Second Playlist' } },
            ],
            nextPageToken: 'page-2',
          }),
          { status: 200 }
        );
      }

      return new Response('', { status: 404 });
    });

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: [
        { id: 'PL1', title: 'First Playlist' },
        { id: 'PL2', title: 'Second Playlist' },
        { id: 'PL3', title: 'Third Playlist' },
      ],
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(global.fetch).mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: { Authorization: 'Bearer yt-access-token' },
      })
    );
  });

  it('returns 502 with upstream error detail when YouTube API fails', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: 'Insufficient permissions to list playlists.' } }),
        { status: 403 }
      )
    );

    const res = await GET(makeRequest());

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.statusCode).toBe(502);
    expect(body.error).toBe('Bad Gateway');
    expect(body.message).toContain('Insufficient permissions');
  });
});
