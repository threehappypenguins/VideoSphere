import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isFacebookGraphTokenError,
  isFacebookPagesSearchPermissionError,
  searchFacebookPlaces,
  searchFacebookPlacesWithFallback,
} from '@/lib/platforms/facebook-places';

describe('isFacebookGraphTokenError', () => {
  it('returns true only for Graph API error code 190', () => {
    expect(
      isFacebookGraphTokenError({
        error: { message: 'Invalid OAuth access token.', type: 'OAuthException', code: 190 },
      })
    ).toBe(true);
  });

  it('returns false for permission OAuthExceptions', () => {
    expect(
      isFacebookGraphTokenError({
        error: {
          message: '(#200) Requires extended permission',
          type: 'OAuthException',
          code: 200,
        },
      })
    ).toBe(false);
  });
});

describe('isFacebookPagesSearchPermissionError', () => {
  it('returns true for Graph API error code 10', () => {
    expect(
      isFacebookPagesSearchPermissionError({
        error: {
          message: "(#10) This endpoint requires the 'pages_read_engagement' permission",
          type: 'OAuthException',
          code: 10,
        },
      })
    ).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(
      isFacebookPagesSearchPermissionError({
        error: { message: 'Invalid OAuth access token.', type: 'OAuthException', code: 190 },
      })
    ).toBe(false);
  });
});

describe('searchFacebookPlaces', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    process.env.FACEBOOK_APP_SECRET = 'test-app-secret';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FACEBOOK_APP_SECRET;
  });

  it('uses Bearer auth and appsecret_proof on the Pages Search request', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: '123',
              name: 'Test Place',
              location: { city: 'Halifax', country: 'Canada' },
            },
          ],
        }),
        { status: 200 }
      )
    );

    const results = await searchFacebookPlaces('user-token', 'coffee');
    expect(results).toEqual([{ id: '123', name: 'Test Place', location: 'Halifax, Canada' }]);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toContain('/pages/search?');
    expect(String(url)).toContain('q=coffee');
    expect(String(url)).toContain('appsecret_proof=');
    const headers = new Headers((init as RequestInit)?.headers);
    expect(headers.get('Authorization')).toBe('Bearer user-token');
  });
});

describe('searchFacebookPlacesWithFallback', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    process.env.FACEBOOK_APP_SECRET = 'test-app-secret';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FACEBOOK_APP_SECRET;
  });

  it('falls back to managed Pages when global search lacks Meta app access', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "(#10) This endpoint requires the 'pages_read_engagement' permission",
              type: 'OAuthException',
              code: 10,
            },
          }),
          { status: 400 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { id: 'page-1', name: 'My Coffee Shop', access_token: 'page-token' },
              { id: 'page-2', name: 'Other Page', access_token: 'page-token-2' },
            ],
          }),
          { status: 200 }
        )
      );

    const result = await searchFacebookPlacesWithFallback('user-token', 'coffee');
    expect(result).toEqual({
      places: [{ id: 'page-1', name: 'My Coffee Shop' }],
      searchMode: 'managed',
    });
  });
});
