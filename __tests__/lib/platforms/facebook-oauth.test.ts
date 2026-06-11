import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FACEBOOK_PAGE_TOKEN_EXPIRY_ISO,
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
      'https://graph.facebook.com/v25.0/me/permissions?access_token=user-token',
      { method: 'DELETE' }
    );
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
