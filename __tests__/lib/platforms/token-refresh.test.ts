import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ConnectedAccount } from '@/types';

const mockRefreshYouTubeAccessToken = vi.fn();
const mockUpdateTokens = vi.fn();

vi.mock('@/lib/platforms/youtube', () => ({
  refreshYouTubeAccessToken: (...args: unknown[]) => mockRefreshYouTubeAccessToken(...args),
}));

const mockRefreshFacebookPageConnection = vi.fn();
const mockRefreshFacebookProfileConnection = vi.fn();

vi.mock('@/lib/platforms/facebook-oauth', () => ({
  refreshFacebookPageConnection: (...args: unknown[]) => mockRefreshFacebookPageConnection(...args),
  refreshFacebookProfileConnection: (...args: unknown[]) =>
    mockRefreshFacebookProfileConnection(...args),
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

function facebookPageAccount(overrides: Partial<ConnectedAccount> = {}): ConnectedAccount {
  return {
    id: 'acc-fb',
    userId: 'user-1',
    platform: 'facebook',
    accessToken: 'page-token',
    refreshToken: 'user-token',
    tokenExpiry: new Date(Date.now() + 3_600_000).toISOString(),
    hasRefreshToken: true,
    platformUserId: 'page-1',
    platformName: 'My Page',
    facebookTargetType: 'page',
    facebookPageId: 'page-1',
    $createdAt: '2020-01-01T00:00:00.000Z',
    $updatedAt: '2020-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function facebookProfileAccount(overrides: Partial<ConnectedAccount> = {}): ConnectedAccount {
  return facebookPageAccount({
    accessToken: 'user-token',
    platformUserId: 'fb-user-1',
    platformName: 'Test User',
    facebookTargetType: 'profile',
    facebookPageId: undefined,
    ...overrides,
  });
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

  it('throws a clear error when Vimeo access token is blank', async () => {
    const acc: ConnectedAccount = {
      id: 'acc-v',
      userId: 'user-1',
      platform: 'vimeo',
      accessToken: '   ',
      refreshToken: '',
      tokenExpiry: new Date(Date.now() + 60_000).toISOString(),
      hasRefreshToken: false,
      platformUserId: 'p1',
      platformName: 'V',
      $createdAt: '2020-01-01T00:00:00.000Z',
      $updatedAt: '2020-01-01T00:00:00.000Z',
    };

    await expect(refreshTokenIfNeeded(acc)).rejects.toThrow(/Reconnect your Vimeo account/i);
    expect(mockRefreshYouTubeAccessToken).not.toHaveBeenCalled();
  });

  it('returns stored SFTP credentials without remote refresh', async () => {
    const acc: ConnectedAccount = {
      id: 'acc-sftp',
      userId: 'user-1',
      platform: 'sftp',
      accessToken: 'sftp-secret',
      refreshToken: '',
      tokenExpiry: '2099-01-01T00:00:00.000Z',
      hasRefreshToken: false,
      platformUserId: 'backup-user',
      platformName: 'Home Server',
      sftpHost: 'sftp.example.com',
      sftpPort: 22,
      sftpRemotePath: '/backups',
      sftpAuthMethod: 'password',
      $createdAt: '2020-01-01T00:00:00.000Z',
      $updatedAt: '2020-01-01T00:00:00.000Z',
    };

    const out = await refreshTokenIfNeeded(acc);
    expect(out.accessToken).toBe('sftp-secret');
    expect(mockRefreshYouTubeAccessToken).not.toHaveBeenCalled();
    expect(mockUpdateTokens).not.toHaveBeenCalled();
  });

  it('returns stored SMB credentials without remote refresh', async () => {
    const acc: ConnectedAccount = {
      id: 'acc-smb',
      userId: 'user-1',
      platform: 'smb',
      accessToken: 'smb-secret',
      refreshToken: '',
      tokenExpiry: '2099-01-01T00:00:00.000Z',
      hasRefreshToken: false,
      platformUserId: 'backup-user',
      platformName: 'My NAS',
      smbHost: '192.168.1.10',
      smbShare: 'Backups',
      smbRemotePath: '/VideoSphere',
      $createdAt: '2020-01-01T00:00:00.000Z',
      $updatedAt: '2020-01-01T00:00:00.000Z',
    };

    const out = await refreshTokenIfNeeded(acc);
    expect(out.accessToken).toBe('smb-secret');
    expect(mockRefreshYouTubeAccessToken).not.toHaveBeenCalled();
    expect(mockUpdateTokens).not.toHaveBeenCalled();
  });

  it('returns stored SermonAudio API key without remote refresh', async () => {
    const acc: ConnectedAccount = {
      id: 'acc-sa',
      userId: 'user-1',
      platform: 'sermon_audio',
      accessToken: 'sa-api-key',
      refreshToken: '',
      tokenExpiry: '9999-12-31T00:00:00.000Z',
      hasRefreshToken: false,
      platformUserId: 'broadcaster-1',
      platformName: 'Example Church',
      $createdAt: '2020-01-01T00:00:00.000Z',
      $updatedAt: '2020-01-01T00:00:00.000Z',
    };

    const out = await refreshTokenIfNeeded(acc);
    expect(out.accessToken).toBe('sa-api-key');
    expect(mockRefreshYouTubeAccessToken).not.toHaveBeenCalled();
    expect(mockUpdateTokens).not.toHaveBeenCalled();
  });

  it('returns a trimmed SermonAudio API key when storage includes whitespace', async () => {
    const acc: ConnectedAccount = {
      id: 'acc-sa',
      userId: 'user-1',
      platform: 'sermon_audio',
      accessToken: '  sa-api-key  ',
      refreshToken: '',
      tokenExpiry: '9999-12-31T00:00:00.000Z',
      hasRefreshToken: false,
      platformUserId: 'broadcaster-1',
      platformName: 'Example Church',
      $createdAt: '2020-01-01T00:00:00.000Z',
      $updatedAt: '2020-01-01T00:00:00.000Z',
    };

    const out = await refreshTokenIfNeeded(acc);
    expect(out.accessToken).toBe('sa-api-key');
  });

  it('throws a clear error when SermonAudio API key is blank', async () => {
    const acc: ConnectedAccount = {
      id: 'acc-sa',
      userId: 'user-1',
      platform: 'sermon_audio',
      accessToken: '   ',
      refreshToken: '',
      tokenExpiry: '9999-12-31T00:00:00.000Z',
      hasRefreshToken: false,
      platformUserId: 'broadcaster-1',
      platformName: 'Example Church',
      $createdAt: '2020-01-01T00:00:00.000Z',
      $updatedAt: '2020-01-01T00:00:00.000Z',
    };

    await expect(refreshTokenIfNeeded(acc)).rejects.toThrow(/Reconnect your SermonAudio account/i);
    expect(mockRefreshYouTubeAccessToken).not.toHaveBeenCalled();
  });

  describe('Facebook', () => {
    it('returns stored Facebook Page tokens when user token expiry is far in the future', async () => {
      const acc = facebookPageAccount({
        tokenExpiry: '2099-01-01T00:00:00.000Z',
      });

      const out = await refreshTokenIfNeeded(acc);

      expect(out).toEqual({
        accessToken: 'page-token',
        refreshToken: 'user-token',
        tokenExpiry: '2099-01-01T00:00:00.000Z',
      });
      expect(mockRefreshFacebookPageConnection).not.toHaveBeenCalled();
      expect(mockUpdateTokens).not.toHaveBeenCalled();
    });

    it('refreshes Facebook Page tokens when user token expiry is past', async () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      mockRefreshFacebookPageConnection.mockResolvedValue({
        pageAccessToken: 'new-page-token',
        userAccessToken: 'new-user-token',
        tokenExpiry: '2099-01-01T00:00:00.000Z',
      });
      mockUpdateTokens.mockResolvedValue({});

      const out = await refreshTokenIfNeeded(facebookPageAccount({ tokenExpiry: past }));

      expect(mockRefreshFacebookPageConnection).toHaveBeenCalledWith('user-token', 'page-1');
      expect(mockUpdateTokens).toHaveBeenCalledWith(
        'acc-fb',
        'new-page-token',
        'new-user-token',
        '2099-01-01T00:00:00.000Z'
      );
      expect(out).toEqual({
        accessToken: 'new-page-token',
        refreshToken: 'new-user-token',
        tokenExpiry: '2099-01-01T00:00:00.000Z',
      });
    });

    it('refreshes Facebook Page tokens when user token expiry is invalid', async () => {
      mockRefreshFacebookPageConnection.mockResolvedValue({
        pageAccessToken: 'new-page-token',
        userAccessToken: 'new-user-token',
        tokenExpiry: '2099-01-01T00:00:00.000Z',
      });
      mockUpdateTokens.mockResolvedValue({});

      await refreshTokenIfNeeded(facebookPageAccount({ tokenExpiry: 'not-a-date' }));

      expect(mockRefreshFacebookPageConnection).toHaveBeenCalledWith('user-token', 'page-1');
    });

    it('throws a clear reconnect error when Facebook user refresh token is missing', async () => {
      const past = new Date(Date.now() - 60_000).toISOString();

      await expect(
        refreshTokenIfNeeded(
          facebookPageAccount({ refreshToken: '', hasRefreshToken: false, tokenExpiry: past })
        )
      ).rejects.toThrow(/Reconnect your Facebook account/i);

      expect(mockRefreshFacebookPageConnection).not.toHaveBeenCalled();
    });

    it('throws a clear reconnect error when Facebook Page access token is blank and refresh is needed', async () => {
      const past = new Date(Date.now() - 60_000).toISOString();

      await expect(
        refreshTokenIfNeeded(
          facebookPageAccount({ accessToken: '   ', refreshToken: '', tokenExpiry: past })
        )
      ).rejects.toThrow(/Reconnect your Facebook account/i);

      expect(mockRefreshFacebookPageConnection).not.toHaveBeenCalled();
    });

    it('throws when Facebook Page refresh fails', async () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      mockRefreshFacebookPageConnection.mockResolvedValue({
        error: 'Facebook Page page-1 is no longer accessible with the stored credentials.',
      });

      await expect(
        refreshTokenIfNeeded(facebookPageAccount({ tokenExpiry: past }))
      ).rejects.toThrow(
        'Facebook token refresh failed: Facebook Page page-1 is no longer accessible with the stored credentials. Please reconnect your Facebook account to continue.'
      );
    });

    it('throws a punctuated reconnect error when Facebook profile refresh fails', async () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      mockRefreshFacebookProfileConnection.mockResolvedValue({
        error: 'Failed to extend Facebook user token.',
      });

      await expect(
        refreshTokenIfNeeded(facebookProfileAccount({ tokenExpiry: past }))
      ).rejects.toThrow(
        'Facebook token refresh failed: Failed to extend Facebook user token. Please reconnect your Facebook account to continue.'
      );

      expect(mockRefreshFacebookProfileConnection).toHaveBeenCalledWith('user-token');
    });

    it('throws when refreshed Facebook tokens cannot be persisted', async () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      mockRefreshFacebookPageConnection.mockResolvedValue({
        pageAccessToken: 'new-page-token',
        userAccessToken: 'new-user-token',
        tokenExpiry: '2099-01-01T00:00:00.000Z',
      });
      mockUpdateTokens.mockResolvedValue(null);

      await expect(
        refreshTokenIfNeeded(facebookPageAccount({ tokenExpiry: past }))
      ).rejects.toThrow(/connected account no longer exists/i);
    });
  });
});
