import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedUserId = vi.fn();
const mockGetConnectedAccountWithTokens = vi.fn();
const mockRefreshTokenIfNeeded = vi.fn();
const mockAutocompleteGooglePlaces = vi.fn();

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
    autocompleteGooglePlaces: (...args: unknown[]) => mockAutocompleteGooglePlaces(...args),
    isGooglePlacesConfigured: () => true,
  };
});

import { GET } from '@/app/api/platforms/youtube/locations/search/route';

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

function makeRequest(query: string, sessionToken = 'session-1'): NextRequest {
  const url = new URL('http://localhost:3000/api/platforms/youtube/locations/search');
  url.searchParams.set('q', query);
  url.searchParams.set('sessionToken', sessionToken);
  return new NextRequest(url.toString(), { method: 'GET' });
}

describe('GET /api/platforms/youtube/locations/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedUserId.mockResolvedValue('user-123');
    mockGetConnectedAccountWithTokens.mockResolvedValue(YOUTUBE_ACCOUNT);
    mockRefreshTokenIfNeeded.mockResolvedValue({
      accessToken: 'yt-access-token',
      refreshToken: 'stored-refresh-token',
      tokenExpiry: YOUTUBE_ACCOUNT.tokenExpiry,
    });
    mockAutocompleteGooglePlaces.mockResolvedValue({
      ok: true,
      suggestions: [{ placeId: 'place-1', description: 'Halifax, NS, Canada' }],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 401 when the user is not authenticated', async () => {
    mockGetAuthenticatedUserId.mockResolvedValueOnce(null);

    const res = await GET(makeRequest('Halifax'));
    expect(res.status).toBe(401);
  });

  it('returns place suggestions for a valid query', async () => {
    const res = await GET(makeRequest('Halifax'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([{ placeId: 'place-1', description: 'Halifax, NS, Canada' }]);
    expect(mockAutocompleteGooglePlaces).toHaveBeenCalledWith(
      'Halifax',
      'session-1',
      expect.any(AbortSignal)
    );
  });

  it('returns 400 when the query is too short', async () => {
    const res = await GET(makeRequest('H'));
    expect(res.status).toBe(400);
  });
});
