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

import { GET as getCategories } from '@/app/api/platforms/vimeo/categories/route';
import { GET as getContentRatings } from '@/app/api/platforms/vimeo/content-ratings/route';
import { GET as getLicenses } from '@/app/api/platforms/vimeo/licenses/route';
import { GET as getMe } from '@/app/api/platforms/vimeo/me/route';

const VIMEO_ACCOUNT = {
  id: 'acc-vm-1',
  userId: 'user-123',
  platform: 'vimeo' as const,
  accessToken: 'stored-access-token',
  refreshToken: 'stored-refresh-token',
  tokenExpiry: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  platformUserId: 'user-1',
  platformName: 'My Vimeo',
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'GET',
  });
}

describe('Vimeo platform metadata routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedUserId.mockResolvedValue('user-123');
    mockGetConnectedAccountWithTokens.mockResolvedValue(VIMEO_ACCOUNT);
    mockRefreshTokenIfNeeded.mockResolvedValue({
      accessToken: 'vimeo-access-token',
      refreshToken: 'stored-refresh-token',
      tokenExpiry: VIMEO_ACCOUNT.tokenExpiry,
    });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 401 when the user is not authenticated', async () => {
    mockGetAuthenticatedUserId.mockResolvedValueOnce(null);

    const res = await getCategories(makeRequest('/api/platforms/vimeo/categories'));

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ statusCode: 401, message: 'Not authenticated' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns content ratings with cache header', async () => {
    vi.mocked(global.fetch).mockImplementation(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('/contentratings');
      return new Response(
        JSON.stringify({
          data: [
            { code: 'safe', name: 'All audiences' },
            { code: 'violence', name: 'Violence' },
            { code: 'unrated', name: 'Not Yet Rated' },
          ],
        }),
        { status: 200 }
      );
    });

    const res = await getContentRatings(makeRequest('/api/platforms/vimeo/content-ratings'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=86400');
    expect(await res.json()).toEqual({
      data: [
        { code: 'safe', name: 'All audiences' },
        { code: 'violence', name: 'Violence' },
        { code: 'unrated', name: 'Not Yet Rated' },
      ],
    });
  });

  it('returns top-level categories with cache header', async () => {
    vi.mocked(global.fetch).mockImplementation(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('/categories');
      return new Response(
        JSON.stringify({
          data: [{ uri: '/categories/music', name: 'Music', top_level: true }],
        }),
        { status: 200 }
      );
    });

    const res = await getCategories(makeRequest('/api/platforms/vimeo/categories'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=86400');
    expect(await res.json()).toEqual({
      data: [{ uri: '/categories/music', name: 'Music', subcategories: [] }],
    });
  });

  it('returns Creative Commons licenses with cache header', async () => {
    vi.mocked(global.fetch).mockImplementation(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('/creativecommons');
      return new Response(
        JSON.stringify({
          data: [
            { code: 'by-nc', name: 'Attribution Non-Commercial', uri: '/creativecommons/by-nc' },
            { code: 'by-sa', name: 'Attribution Share Alike', uri: '/creativecommons/by-sa' },
          ],
        }),
        { status: 200 }
      );
    });

    const res = await getLicenses(makeRequest('/api/platforms/vimeo/licenses'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=86400');
    expect(await res.json()).toEqual({
      data: [
        { code: 'by-nc', name: 'Attribution Non-Commercial' },
        { code: 'by-sa', name: 'Attribution Share Alike' },
      ],
    });
  });

  it('returns account defaults from /me', async () => {
    vi.mocked(global.fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/contentratings')) {
        return new Response(
          JSON.stringify({
            data: [
              { code: 'safe', name: 'All audiences' },
              { code: 'violence', name: 'Violence' },
              { code: 'language', name: 'Language' },
              { code: 'unrated', name: 'Not Yet Rated' },
            ],
          }),
          { status: 200 }
        );
      }
      expect(url).toContain('/me');
      return new Response(
        JSON.stringify({
          preferences: {
            videos: {
              rating: ['safe'],
              license: null,
            },
          },
        }),
        { status: 200 }
      );
    });

    const res = await getMe(makeRequest('/api/platforms/vimeo/me'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
    expect(await res.json()).toEqual({
      data: {
        contentRating: ['safe'],
        license: null,
      },
    });
  });
});
