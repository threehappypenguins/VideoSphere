import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedUserId = vi.fn();
const mockGetConnectedAccountWithTokens = vi.fn();
const mockRefreshTokenIfNeeded = vi.fn();
const mockResolveGooglePlaceLocation = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

vi.mock('@/lib/repositories/connected-accounts', () => ({
  getConnectedAccountWithTokens: (...args: unknown[]) => mockGetConnectedAccountWithTokens(...args),
}));

vi.mock('@/lib/platforms/token-refresh', () => ({
  refreshTokenIfNeeded: (...args: unknown[]) => mockRefreshTokenIfNeeded(...args),
}));

vi.mock('@/lib/platforms/google-places', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/platforms/google-places')>();
  return {
    ...actual,
    resolveGooglePlaceLocation: (...args: unknown[]) => mockResolveGooglePlaceLocation(...args),
    isGooglePlacesConfigured: () => true,
  };
});

import { GET } from '@/app/api/platforms/youtube/locations/details/route';

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

function makeRequest(
  placeId: string,
  sessionToken = 'session-1',
  description = 'Halifax, NS, Canada'
): NextRequest {
  const url = new URL('http://localhost:3000/api/platforms/youtube/locations/details');
  url.searchParams.set('placeId', placeId);
  url.searchParams.set('sessionToken', sessionToken);
  url.searchParams.set('description', description);
  return new NextRequest(url.toString(), { method: 'GET' });
}

describe('GET /api/platforms/youtube/locations/details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedUserId.mockResolvedValue('user-123');
    mockGetConnectedAccountWithTokens.mockResolvedValue(YOUTUBE_ACCOUNT);
    mockRefreshTokenIfNeeded.mockResolvedValue({
      accessToken: 'yt-access-token',
      refreshToken: 'stored-refresh-token',
      tokenExpiry: YOUTUBE_ACCOUNT.tokenExpiry,
    });
    mockResolveGooglePlaceLocation.mockResolvedValue({
      ok: true,
      location: {
        placeId: 'place-1',
        description: 'Halifax, NS, Canada',
        latitude: 44.6488,
        longitude: -63.5752,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns resolved location details for a place id', async () => {
    const res = await GET(makeRequest('place-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      placeId: 'place-1',
      description: 'Halifax, NS, Canada',
      latitude: 44.6488,
      longitude: -63.5752,
    });
    expect(mockResolveGooglePlaceLocation).toHaveBeenCalledWith(
      'place-1',
      'session-1',
      'Halifax, NS, Canada',
      expect.any(AbortSignal)
    );
  });
});
