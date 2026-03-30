import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ConnectedAccount } from '@/types';

const mockRefreshYouTubeAccessToken = vi.fn();
const mockUpdateTokens = vi.fn();

vi.mock('@/lib/platforms/youtube', () => ({
  refreshYouTubeAccessToken: (...args: unknown[]) => mockRefreshYouTubeAccessToken(...args),
}));

vi.mock('@/lib/repositories/connected-accounts', () => ({
  updateTokens: (...args: unknown[]) => mockUpdateTokens(...args),
}));

import {
  tokenNeedsRefresh,
  refreshTokenIfNeeded,
  TOKEN_REFRESH_LEAD_MS,
} from '@/lib/platforms/token-refresh';

function youtubeAccount(overrides: Partial<ConnectedAccount> = {}): ConnectedAccount {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  return {
    id: 'acc-1',
    userId: 'user-1',
    platform: 'youtube',
    accessToken: 'access',
    refreshToken: 'refresh',
    tokenExpiry: future,
    hasRefreshToken: true,
    platformUserId: 'p1',
    platformName: 'Ch',
    $createdAt: '2020-01-01T00:00:00.000Z',
    $updatedAt: '2020-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('tokenNeedsRefresh', () => {
  it('returns true when access token is missing', () => {
    const t = new Date(Date.now() + TOKEN_REFRESH_LEAD_MS + 60_000).toISOString();
    expect(tokenNeedsRefresh(t, Date.now(), '')).toBe(true);
  });

  it('returns false when expiry is beyond the lead window', () => {
    const t = new Date(Date.now() + TOKEN_REFRESH_LEAD_MS + 60_000).toISOString();
    expect(tokenNeedsRefresh(t, Date.now(), 'access')).toBe(false);
  });

  it('returns true when expiry is within the lead window', () => {
    const t = new Date(Date.now() + TOKEN_REFRESH_LEAD_MS - 1000).toISOString();
    expect(tokenNeedsRefresh(t, Date.now(), 'access')).toBe(true);
  });

  it('returns true for invalid ISO strings', () => {
    expect(tokenNeedsRefresh('not-a-date', Date.now(), 'access')).toBe(true);
  });
});

describe('refreshTokenIfNeeded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns existing tokens when not near expiry', async () => {
    const acc = youtubeAccount();
    const out = await refreshTokenIfNeeded(acc);
    expect(out.accessToken).toBe('access');
    expect(mockRefreshYouTubeAccessToken).not.toHaveBeenCalled();
    expect(mockUpdateTokens).not.toHaveBeenCalled();
  });

  it('refreshes YouTube, persists tokens, and returns new bundle', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const newExpiry = new Date(Date.now() + 3600_000).toISOString();
    mockRefreshYouTubeAccessToken.mockResolvedValue({
      ok: true,
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      tokenExpiry: newExpiry,
    });
    mockUpdateTokens.mockResolvedValue({});

    const acc = youtubeAccount({ tokenExpiry: past });
    const out = await refreshTokenIfNeeded(acc);

    expect(mockRefreshYouTubeAccessToken).toHaveBeenCalledWith({ refreshToken: 'refresh' });
    expect(mockUpdateTokens).toHaveBeenCalledWith('acc-1', 'new-access', 'new-refresh', newExpiry);
    expect(out).toEqual({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      tokenExpiry: newExpiry,
    });
  });

  it('throws when refreshed tokens cannot be persisted', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const newExpiry = new Date(Date.now() + 3600_000).toISOString();
    mockRefreshYouTubeAccessToken.mockResolvedValue({
      ok: true,
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      tokenExpiry: newExpiry,
    });
    mockUpdateTokens.mockResolvedValue(null);

    const acc = youtubeAccount({ tokenExpiry: past });
    await expect(refreshTokenIfNeeded(acc)).rejects.toThrow(/connected account no longer exists/i);
  });

  it('throws when YouTube refresh fails', async () => {
    mockRefreshYouTubeAccessToken.mockResolvedValue({
      ok: false,
      error: { code: 'YOUTUBE_TOKEN_REFRESH_FAILED', message: 'revoked' },
    });

    const acc = youtubeAccount({ tokenExpiry: new Date(Date.now() - 1000).toISOString() });
    await expect(refreshTokenIfNeeded(acc)).rejects.toThrow(/YOUTUBE_TOKEN_REFRESH_FAILED/);
  });

  it('returns stored Vimeo tokens without calling YouTube refresh', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const acc: ConnectedAccount = {
      id: 'acc-v',
      userId: 'user-1',
      platform: 'vimeo',
      accessToken: 'vimeo-access',
      refreshToken: '',
      tokenExpiry: past,
      hasRefreshToken: false,
      platformUserId: 'p1',
      platformName: 'V',
      $createdAt: '2020-01-01T00:00:00.000Z',
      $updatedAt: '2020-01-01T00:00:00.000Z',
    };

    const out = await refreshTokenIfNeeded(acc);
    expect(out.accessToken).toBe('vimeo-access');
    expect(mockRefreshYouTubeAccessToken).not.toHaveBeenCalled();
  });
});
