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

import { GET } from '@/app/api/platforms/youtube/account-defaults/route';

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
  return new NextRequest('http://localhost:3000/api/platforms/youtube/account-defaults', {
    method: 'GET',
  });
}

describe('GET /api/platforms/youtube/account-defaults', () => {
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
  });

  it('returns channel and latest-upload defaults from YouTube', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              snippet: { defaultLanguage: 'en' },
              brandingSettings: { channel: {} },
              status: { selfDeclaredMadeForKids: false },
              contentDetails: { relatedPlaylists: { uploads: 'UU-uploads' } },
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ contentDetails: { videoId: 'video-123' } }],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              snippet: { defaultLanguage: 'en', categoryId: '22' },
              status: {
                license: 'youtube',
                embeddable: true,
                publicStatsViewable: true,
              },
            },
          ],
        }),
      } as Response);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    expect(await res.json()).toEqual({
      data: {
        defaultLanguage: 'en',
        titleDescriptionLanguage: 'en',
        madeForKids: false,
        categoryId: '22',
        license: 'youtube',
        embeddable: true,
        publicStatsViewable: true,
      },
    });

    const channelCall = vi.mocked(global.fetch).mock.calls[0];
    expect(String(channelCall?.[0])).toContain('/youtube/v3/channels');
    expect(String(channelCall?.[0])).toContain(
      'part=snippet%2CbrandingSettings%2Cstatus%2CcontentDetails'
    );

    const playlistItemsCall = vi.mocked(global.fetch).mock.calls[1];
    expect(String(playlistItemsCall?.[0])).toContain('/youtube/v3/playlistItems');
    expect(String(playlistItemsCall?.[0])).toContain('playlistId=UU-uploads');

    const videoCall = vi.mocked(global.fetch).mock.calls[2];
    expect(String(videoCall?.[0])).toContain('/youtube/v3/videos');
    expect(String(videoCall?.[0])).toContain('id=video-123');
  });

  it('uses latest upload language when the channel has no defaultLanguage', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              snippet: {},
              brandingSettings: { channel: {} },
              contentDetails: { relatedPlaylists: { uploads: 'UU-uploads' } },
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ contentDetails: { videoId: 'video-fr' } }],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ snippet: { defaultLanguage: 'fr', categoryId: '10' }, status: {} }],
        }),
      } as Response);

    const res = await GET(makeRequest());
    expect(await res.json()).toEqual({
      data: {
        defaultLanguage: 'fr',
        titleDescriptionLanguage: 'fr',
        categoryId: '10',
      },
    });
  });

  it('returns 502 when YouTube channels.list fails', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ error: { message: 'Forbidden' } }),
    } as Response);

    const res = await GET(makeRequest());
    expect(res.status).toBe(502);
  });
});
