import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ConnectedAccount, ConnectedAccountPublic } from '@/types';

const mockGetConnectedAccountsByUser = vi.fn();
const mockGetConnectedAccountWithTokens = vi.fn();
const mockGetConnectedAccountForUser = vi.fn();
const mockRefreshTokenIfNeeded = vi.fn();

vi.mock('@/lib/repositories/connected-accounts', () => ({
  getConnectedAccountsByUser: (...args: unknown[]) => mockGetConnectedAccountsByUser(...args),
  getConnectedAccountWithTokens: (...args: unknown[]) => mockGetConnectedAccountWithTokens(...args),
  getConnectedAccountForUser: (...args: unknown[]) => mockGetConnectedAccountForUser(...args),
}));

vi.mock('@/lib/platforms/token-refresh', () => ({
  refreshTokenIfNeeded: (...args: unknown[]) => mockRefreshTokenIfNeeded(...args),
}));

import { getConnectedAccountsWithHealth } from '@/lib/platforms/connected-accounts-health';

const USER_ID = 'user-1';

function publicYoutube(overrides: Partial<ConnectedAccountPublic> = {}): ConnectedAccountPublic {
  return {
    id: 'acc-1',
    userId: USER_ID,
    platform: 'youtube',
    tokenExpiry: new Date(Date.now() - 1000).toISOString(),
    hasRefreshToken: true,
    hasYoutubeMainStreamKey: false,
    hasYoutubeTempStreamKey: false,
    platformUserId: 'yt-1',
    platformName: 'Channel',
    $createdAt: '2020-01-01T00:00:00.000Z',
    $updatedAt: '2020-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getConnectedAccountsWithHealth', () => {
  it('marks OAuth accounts expired when refresh fails', async () => {
    const account = publicYoutube();
    mockGetConnectedAccountsByUser.mockResolvedValue([account]);
    mockGetConnectedAccountWithTokens.mockResolvedValue({
      ...account,
      accessToken: 'access',
      refreshToken: 'refresh',
    } satisfies ConnectedAccount);
    mockRefreshTokenIfNeeded.mockRejectedValue(
      new Error('YOUTUBE_TOKEN_REFRESH_FAILED: invalid_grant')
    );
    mockGetConnectedAccountForUser.mockResolvedValue({
      ...account,
      hasRefreshToken: false,
    });

    const result = await getConnectedAccountsWithHealth(USER_ID);

    expect(mockRefreshTokenIfNeeded).toHaveBeenCalledWith(expect.anything(), { force: true });
    expect(result).toEqual([
      expect.objectContaining({
        id: 'acc-1',
        connectionStatus: 'expired',
        hasRefreshToken: false,
      }),
    ]);
  });

  it('keeps OAuth accounts connected when refresh succeeds', async () => {
    const account = publicYoutube();
    const refreshedPublic = {
      ...account,
      tokenExpiry: new Date(Date.now() + 3_600_000).toISOString(),
      hasRefreshToken: true,
    };
    mockGetConnectedAccountsByUser.mockResolvedValue([account]);
    mockGetConnectedAccountWithTokens.mockResolvedValue({
      ...account,
      accessToken: 'access',
      refreshToken: 'refresh',
    } satisfies ConnectedAccount);
    mockRefreshTokenIfNeeded.mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'refresh',
      tokenExpiry: refreshedPublic.tokenExpiry,
    });
    mockGetConnectedAccountForUser.mockResolvedValue(refreshedPublic);

    const result = await getConnectedAccountsWithHealth(USER_ID);

    expect(result).toEqual([
      expect.objectContaining({
        id: 'acc-1',
        connectionStatus: 'connected',
      }),
    ]);
  });
});
