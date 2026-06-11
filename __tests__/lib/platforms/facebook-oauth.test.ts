import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { revokeFacebookAppAuthorization } from '@/lib/platforms/facebook-oauth';

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
