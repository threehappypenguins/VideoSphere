import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSearchFacebookPlacesWithFallback = vi.fn();
const mockRefreshFacebookPageConnection = vi.fn();
const mockUpdateTokens = vi.fn();

vi.mock('@/lib/platforms/facebook-places', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/platforms/facebook-places')>();
  return {
    ...actual,
    searchFacebookPlacesWithFallback: (...args: unknown[]) =>
      mockSearchFacebookPlacesWithFallback(...args),
  };
});

vi.mock('@/lib/platforms/facebook-oauth', () => ({
  FACEBOOK_PAGE_TOKEN_EXPIRY_ISO: '2099-01-01T00:00:00.000Z',
  refreshFacebookPageConnection: (...args: unknown[]) => mockRefreshFacebookPageConnection(...args),
}));

vi.mock('@/lib/repositories/connected-accounts', () => ({
  updateTokens: (...args: unknown[]) => mockUpdateTokens(...args),
}));

import { searchFacebookPlacesWithTokenRefresh } from '@/lib/platforms/facebook-api';
import type { ConnectedAccount } from '@/types';

const account: ConnectedAccount = {
  id: 'conn-1',
  userId: 'user-1',
  platform: 'facebook',
  tokenExpiry: '2099-01-01T00:00:00.000Z',
  hasRefreshToken: true,
  platformUserId: 'page-1',
  platformName: 'Test Page',
  facebookPageId: 'page-1',
  accessToken: 'page-token',
  refreshToken: 'user-token',
  $createdAt: '2000-01-01T00:00:00.000Z',
  $updatedAt: '2000-01-01T00:00:00.000Z',
};

describe('searchFacebookPlacesWithTokenRefresh', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('does not attempt token refresh for unrelated permission errors', async () => {
    const permissionErr = new Error('(#200) Missing Permission') as Error & {
      graphBody?: unknown;
    };
    permissionErr.graphBody = {
      error: { message: '(#200) Missing Permission', type: 'OAuthException', code: 200 },
    };
    mockSearchFacebookPlacesWithFallback.mockRejectedValueOnce(permissionErr);

    await expect(searchFacebookPlacesWithTokenRefresh(account, 'coffee')).rejects.toThrow(
      '(#200) Missing Permission'
    );
    expect(mockRefreshFacebookPageConnection).not.toHaveBeenCalled();
    expect(mockUpdateTokens).not.toHaveBeenCalled();
  });

  it('refreshes and retries once when the user token is expired', async () => {
    const tokenErr = new Error('Invalid OAuth access token.') as Error & { graphBody?: unknown };
    tokenErr.graphBody = {
      error: { message: 'Invalid OAuth access token.', type: 'OAuthException', code: 190 },
    };
    mockSearchFacebookPlacesWithFallback
      .mockRejectedValueOnce(tokenErr)
      .mockResolvedValueOnce({ places: [{ id: '1', name: 'Place' }], searchMode: 'global' });
    mockRefreshFacebookPageConnection.mockResolvedValueOnce({
      pageAccessToken: 'new-page-token',
      userAccessToken: 'new-user-token',
      tokenExpiry: '2099-01-01T00:00:00.000Z',
    });
    mockUpdateTokens.mockResolvedValueOnce({});

    const result = await searchFacebookPlacesWithTokenRefresh(account, 'coffee');
    expect(result).toEqual({ places: [{ id: '1', name: 'Place' }], searchMode: 'global' });
    expect(mockRefreshFacebookPageConnection).toHaveBeenCalledWith('user-token', 'page-1');
    expect(mockUpdateTokens).toHaveBeenCalledWith(
      'conn-1',
      'new-page-token',
      'new-user-token',
      '2099-01-01T00:00:00.000Z'
    );
    expect(mockSearchFacebookPlacesWithFallback).toHaveBeenCalledTimes(2);
    expect(mockSearchFacebookPlacesWithFallback).toHaveBeenLastCalledWith(
      'new-user-token',
      'coffee'
    );
  });
});
