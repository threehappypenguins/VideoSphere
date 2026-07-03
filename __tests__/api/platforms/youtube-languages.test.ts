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

import { GET } from '@/app/api/platforms/youtube/languages/route';

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
  return new NextRequest('http://localhost:3000/api/platforms/youtube/languages', {
    method: 'GET',
  });
}

describe('GET /api/platforms/youtube/languages', () => {
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

  it('returns languages sorted alphabetically by name with cache header', async () => {
    vi.mocked(global.fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('/youtube/v3/i18nLanguages');
      expect(url).toContain('hl=en');

      return new Response(
        JSON.stringify({
          items: [
            { id: 'es', snippet: { hl: 'es', name: 'Spanish' } },
            { id: 'en', snippet: { hl: 'en', name: 'English' } },
            { id: 'de', snippet: { hl: 'de', name: 'German' } },
          ],
        }),
        { status: 200 }
      );
    });

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=604800');
    expect(await res.json()).toEqual({
      data: [
        { id: 'en', name: 'English' },
        { id: 'de', name: 'German' },
        { id: 'es', name: 'Spanish' },
      ],
    });
  });

  it('returns 401 when YouTube rejects the access token', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message:
              'Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.',
          },
        }),
        { status: 401 }
      )
    );

    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.statusCode).toBe(401);
    expect(body.message).toContain('Reconnect your YouTube account');
    expect(mockRefreshTokenIfNeeded).toHaveBeenCalledWith(expect.anything(), { force: true });
  });

  it('returns 502 when YouTube API fails for non-auth reasons', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Quota exceeded' } }), { status: 403 })
    );

    const res = await GET(makeRequest());

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.statusCode).toBe(502);
    expect(body.message).toContain('Quota exceeded');
  });
});
