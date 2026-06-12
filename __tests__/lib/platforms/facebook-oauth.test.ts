import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FACEBOOK_PAGE_TOKEN_EXPIRY_ISO,
  fetchFacebookManagedPages,
  getFacebookTokenExpiry,
  revokeFacebookAppAuthorization,
} from '@/lib/platforms/facebook-oauth';

const mockFetch = vi.fn();

describe('revokeFacebookAppAuthorization', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls DELETE /me/permissions with the provided access token', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    const revoked = await revokeFacebookAppAuthorization('user-token');

    expect(revoked).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://graph.facebook.com/v25.0/me/permissions',
      expect.objectContaining({
        method: 'DELETE',
        cache: 'no-store',
        headers: expect.any(Headers),
      })
    );
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer user-token');
  });

  it('returns false when Meta rejects the revocation request', async () => {
    mockFetch.mockResolvedValue({ ok: false });

    await expect(revokeFacebookAppAuthorization('expired-token')).resolves.toBe(false);
  });
});

describe('getFacebookTokenExpiry', () => {
  it('returns a far-future sentinel for Page connections', () => {
    expect(getFacebookTokenExpiry('page', 5_184_000)).toBe(FACEBOOK_PAGE_TOKEN_EXPIRY_ISO);
  });

  it('returns user token expiry for profile connections', () => {
    const before = Date.now();
    const expiry = getFacebookTokenExpiry('profile', 3600);
    const after = Date.now();

    const expiryMs = Date.parse(expiry);
    expect(expiryMs).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(expiryMs).toBeLessThanOrEqual(after + 3600 * 1000);
  });
});

describe('fetchFacebookManagedPages', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('logs Graph API error payloads returned with HTTP 200 and returns an empty list', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        error: { message: 'Invalid OAuth access token.', type: 'OAuthException', code: 190 },
      }),
    });

    await expect(fetchFacebookManagedPages('bad-token')).resolves.toEqual([]);

    expect(consoleError).toHaveBeenCalledWith(
      '[fetchFacebookManagedPages] Graph API GET /me/accounts returned error:',
      { message: 'Invalid OAuth access token.', type: 'OAuthException', code: 190 }
    );

    consoleError.mockRestore();
  });

  it('follows cursor pagination and returns Pages from all result pages', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'page-1', name: 'First Page', access_token: 'token-1' }],
          paging: {
            cursors: { after: 'cursor-page-2' },
            next: 'https://graph.facebook.com/v25.0/me/accounts?after=cursor-page-2',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'page-2', name: 'Second Page', access_token: 'token-2' }],
        }),
      });

    await expect(fetchFacebookManagedPages('user-token')).resolves.toEqual([
      { id: 'page-1', name: 'First Page', access_token: 'token-1' },
      { id: 'page-2', name: 'Second Page', access_token: 'token-2' },
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toContain('limit=100');
    expect(mockFetch.mock.calls[1][0]).toContain('after=cursor-page-2');
  });
});
