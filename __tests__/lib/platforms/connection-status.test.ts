import { describe, it, expect } from 'vitest';
import {
  accountNeedsOAuthHealthProbe,
  getConnectionStatus,
  getUsableConnectedPlatforms,
  isUsablePlatformConnection,
  resolveConnectionStatus,
} from '@/lib/platforms/connection-status';
import type { ConnectedAccountPublic } from '@/types';

function youtubeAccount(overrides: Partial<ConnectedAccountPublic> = {}): ConnectedAccountPublic {
  return {
    id: 'acc-1',
    userId: 'user-1',
    platform: 'youtube',
    tokenExpiry: new Date(Date.now() + 3_600_000).toISOString(),
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

describe('connection-status', () => {
  it('treats OAuth rows with expired access and refresh token as connected before health probe', () => {
    const account = youtubeAccount({
      tokenExpiry: new Date(Date.now() - 1000).toISOString(),
      hasRefreshToken: true,
    });
    expect(getConnectionStatus(account)).toBe('connected');
    expect(accountNeedsOAuthHealthProbe(account)).toBe(true);
  });

  it('probes OAuth rows with a valid expiry when a refresh token is stored', () => {
    const account = youtubeAccount({
      tokenExpiry: new Date(Date.now() + 3_600_000).toISOString(),
      hasRefreshToken: true,
    });
    expect(getConnectionStatus(account)).toBe('connected');
    expect(accountNeedsOAuthHealthProbe(account)).toBe(true);
  });

  it('treats OAuth rows with a future access expiry but no refresh token as expired', () => {
    const account = youtubeAccount({
      tokenExpiry: new Date(Date.now() + 3_600_000).toISOString(),
      hasRefreshToken: false,
    });
    expect(getConnectionStatus(account)).toBe('expired');
    expect(accountNeedsOAuthHealthProbe(account)).toBe(false);
    expect(isUsablePlatformConnection(account)).toBe(false);
  });

  it('prefers server-verified connectionStatus over static derivation', () => {
    const account = youtubeAccount({
      tokenExpiry: new Date(Date.now() - 1000).toISOString(),
      hasRefreshToken: true,
      connectionStatus: 'expired',
    });
    expect(resolveConnectionStatus(account)).toBe('expired');
    expect(isUsablePlatformConnection(account)).toBe(false);
  });

  it('returns only usable platforms from connections payload', () => {
    const accounts = [
      youtubeAccount({ connectionStatus: 'connected' }),
      youtubeAccount({
        id: 'acc-2',
        platform: 'vimeo',
        connectionStatus: 'expired',
      }),
    ];
    expect(getUsableConnectedPlatforms(accounts)).toEqual(['youtube']);
  });
});
