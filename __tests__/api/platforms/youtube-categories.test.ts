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

import { GET } from '@/app/api/platforms/youtube/categories/route';

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
  return new NextRequest('http://localhost:3000/api/platforms/youtube/categories', {
    method: 'GET',
  });
}

describe('GET /api/platforms/youtube/categories', () => {
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
    expect(await res.json()).toMatchObject({ statusCode: 401, message: 'Not authenticated' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns 401 when YouTube is not connected', async () => {
    mockGetConnectedAccountWithTokens.mockResolvedValueOnce(null);

    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      statusCode: 401,
      message: 'YouTube is not connected',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns assignable categories only with cache header', async () => {
    vi.mocked(global.fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('/youtube/v3/videoCategories');
      expect(url).toContain('regionCode=US');
      expect(url).toContain('hl=en');

      return new Response(
        JSON.stringify({
          items: [
            { id: '1', snippet: { title: 'Film & Animation', assignable: true } },
            { id: '2', snippet: { title: 'Nonprofit', assignable: false } },
            { id: '22', snippet: { title: 'People & Blogs', assignable: true } },
          ],
        }),
        { status: 200 }
      );
    });

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
    expect(await res.json()).toEqual({
      data: [
        { id: '1', title: 'Film & Animation' },
        { id: '22', title: 'People & Blogs' },
      ],
    });
  });

  it('returns 502 when YouTube API fails', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Backend error' } }), { status: 500 })
    );

    const res = await GET(makeRequest());

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.statusCode).toBe(502);
    expect(body.message).toContain('Backend error');
  });
});
