/**
 * Tests for GET /api/platforms/callback/drive
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { TokenDecryptError } from '@/lib/crypto/token-encryption';

vi.mock('@/lib/repositories/connected-accounts', () => ({
  createConnectedAccount: vi.fn(),
  getConnectedAccount: vi.fn(),
  getConnectedAccountRowId: vi.fn(),
  getConnectedAccountWithTokens: vi.fn(),
  updateConnection: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { GET } from '@/app/api/platforms/callback/drive/route';
import {
  createConnectedAccount,
  getConnectedAccount,
  getConnectedAccountRowId,
  getConnectedAccountWithTokens,
  updateConnection,
} from '@/lib/repositories/connected-accounts';

const CSRF_NONCE = 'b'.repeat(64);
const USER_ID = 'user-1';
const CSRF_COOKIE = 'google_drive_oauth_state';
const VALID_COOKIE_VALUE = `${CSRF_NONCE}|${USER_ID}`;

function makeRequest(
  params: Record<string, string> = {},
  cookies: Record<string, string> = {}
): NextRequest {
  const url = new URL('http://localhost:3000/api/platforms/callback/drive');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return new NextRequest(url, {
    method: 'GET',
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
  });
}

const VALID_PARAMS = { code: 'auth-code', state: CSRF_NONCE };

const TOKEN_RESPONSE = {
  access_token: 'drive-access-token',
  refresh_token: 'drive-refresh-token',
  expires_in: 3600,
};

const ABOUT_RESPONSE = {
  user: {
    displayName: 'Drive User',
    emailAddress: 'drive@example.com',
    permissionId: 'perm-123',
  },
};

describe('GET /api/platforms/callback/drive', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.GOOGLE_DRIVE_CLIENT_ID = 'drive-client-id';
    process.env.GOOGLE_DRIVE_CLIENT_SECRET = 'drive-client-secret';
  });

  afterEach(() => {
    delete process.env.GOOGLE_DRIVE_CLIENT_ID;
    delete process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  });

  it('returns error redirect HTML when env vars are missing', async () => {
    delete process.env.GOOGLE_DRIVE_CLIENT_ID;
    const req = makeRequest(VALID_PARAMS, { [CSRF_COOKIE]: VALID_COOKIE_VALUE });
    const res = await GET(req);
    expect(await res.text()).toContain('error=google_drive');
  });

  it('returns error redirect HTML on csrf mismatch', async () => {
    const req = makeRequest(
      { code: 'x', state: 'wrong-state' },
      { [CSRF_COOKIE]: VALID_COOKIE_VALUE }
    );
    const res = await GET(req);
    expect(await res.text()).toContain('error=google_drive');
  });

  it('creates connected account on success', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => TOKEN_RESPONSE,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ABOUT_RESPONSE,
      });

    vi.mocked(getConnectedAccountWithTokens).mockResolvedValue(null);
    vi.mocked(createConnectedAccount).mockResolvedValue({
      id: 'ca-1',
      userId: USER_ID,
      platform: 'google_drive',
      tokenExpiry: new Date().toISOString(),
      hasRefreshToken: true,
      platformUserId: 'perm-123',
      platformName: 'Drive User',
      $createdAt: new Date().toISOString(),
      $updatedAt: new Date().toISOString(),
    });

    const req = makeRequest(VALID_PARAMS, { [CSRF_COOKIE]: VALID_COOKIE_VALUE });
    const res = await GET(req);

    expect(await res.text()).toContain('success=google_drive');
    expect(createConnectedAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        platform: 'google_drive',
        accessToken: 'drive-access-token',
      })
    );
  });

  it('updates existing connection on reconnect', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => TOKEN_RESPONSE,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ABOUT_RESPONSE,
      });

    vi.mocked(getConnectedAccountWithTokens).mockResolvedValue({
      id: 'ca-existing',
      userId: USER_ID,
      platform: 'google_drive',
      tokenExpiry: new Date().toISOString(),
      hasRefreshToken: true,
      platformUserId: 'perm-older',
      platformName: 'Drive User',
      $createdAt: new Date().toISOString(),
      $updatedAt: new Date().toISOString(),
      accessToken: 'old-access-token',
      refreshToken: 'old-refresh-token',
    });
    vi.mocked(getConnectedAccount).mockResolvedValue({
      id: 'ca-existing',
      userId: USER_ID,
      platform: 'google_drive',
      tokenExpiry: new Date().toISOString(),
      hasRefreshToken: true,
      platformUserId: 'perm-older',
      platformName: 'Drive User',
      $createdAt: new Date().toISOString(),
      $updatedAt: new Date().toISOString(),
    });

    vi.mocked(updateConnection).mockResolvedValue({
      id: 'ca-existing',
      userId: USER_ID,
      platform: 'google_drive',
      tokenExpiry: new Date().toISOString(),
      hasRefreshToken: true,
      platformUserId: 'perm-123',
      platformName: 'Drive User',
      $createdAt: new Date().toISOString(),
      $updatedAt: new Date().toISOString(),
    });

    const req = makeRequest(VALID_PARAMS, { [CSRF_COOKIE]: VALID_COOKIE_VALUE });
    await GET(req);

    expect(updateConnection).toHaveBeenCalledWith(
      'ca-existing',
      'drive-access-token',
      'drive-refresh-token',
      expect.any(String),
      'perm-123',
      'Drive User'
    );
  });

  it('falls back to public account lookup when token decryption fails and still succeeds', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => TOKEN_RESPONSE,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ABOUT_RESPONSE,
      });

    vi.mocked(getConnectedAccountWithTokens).mockRejectedValue(
      new TokenDecryptError('Unsupported state or unable to authenticate data')
    );
    vi.mocked(getConnectedAccountRowId).mockResolvedValue({
      id: 'ca-existing',
      platformUserId: '{"permissionId":"perm-older","rootFolderId":"folder-root-1"}',
    });
    vi.mocked(updateConnection).mockResolvedValue({
      id: 'ca-existing',
      userId: USER_ID,
      platform: 'google_drive',
      tokenExpiry: new Date().toISOString(),
      hasRefreshToken: true,
      platformUserId: '{"permissionId":"perm-123","rootFolderId":"folder-root-1"}',
      platformName: 'Drive User',
      $createdAt: new Date().toISOString(),
      $updatedAt: new Date().toISOString(),
    });

    const req = makeRequest(VALID_PARAMS, { [CSRF_COOKIE]: VALID_COOKIE_VALUE });
    const res = await GET(req);

    expect(updateConnection).toHaveBeenCalledWith(
      'ca-existing',
      'drive-access-token',
      'drive-refresh-token',
      expect.any(String),
      '{"permissionId":"perm-123","rootFolderId":"folder-root-1"}',
      'Drive User'
    );
    expect(createConnectedAccount).not.toHaveBeenCalled();
    expect(await res.text()).toContain('success=google_drive');
  });

  it('does not fallback on non-decrypt repository errors and returns error redirect', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => TOKEN_RESPONSE,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ABOUT_RESPONSE,
      });

    vi.mocked(getConnectedAccountWithTokens).mockRejectedValue(
      new Error('Appwrite listRows failed: ECONNRESET')
    );

    const req = makeRequest(VALID_PARAMS, { [CSRF_COOKIE]: VALID_COOKIE_VALUE });
    const res = await GET(req);

    expect(getConnectedAccount).not.toHaveBeenCalled();
    expect(updateConnection).not.toHaveBeenCalled();
    expect(createConnectedAccount).not.toHaveBeenCalled();
    expect(await res.text()).toContain('error=google_drive');
  });

  it('preserves the stored Drive root folder id on reconnect', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => TOKEN_RESPONSE,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ABOUT_RESPONSE,
      });

    vi.mocked(getConnectedAccountWithTokens).mockResolvedValue({
      id: 'ca-existing',
      userId: USER_ID,
      platform: 'google_drive',
      tokenExpiry: new Date().toISOString(),
      hasRefreshToken: true,
      platformUserId: '{"permissionId":"perm-older","rootFolderId":"folder-root-1"}',
      platformName: 'Drive User',
      $createdAt: new Date().toISOString(),
      $updatedAt: new Date().toISOString(),
      accessToken: 'old-access-token',
      refreshToken: 'old-refresh-token',
    });

    vi.mocked(updateConnection).mockResolvedValue({
      id: 'ca-existing',
      userId: USER_ID,
      platform: 'google_drive',
      tokenExpiry: new Date().toISOString(),
      hasRefreshToken: true,
      platformUserId: '{"permissionId":"perm-123","rootFolderId":"folder-root-1"}',
      platformName: 'Drive User',
      $createdAt: new Date().toISOString(),
      $updatedAt: new Date().toISOString(),
    });

    const req = makeRequest(VALID_PARAMS, { [CSRF_COOKIE]: VALID_COOKIE_VALUE });
    await GET(req);

    expect(updateConnection).toHaveBeenCalledWith(
      'ca-existing',
      'drive-access-token',
      'drive-refresh-token',
      expect.any(String),
      '{"permissionId":"perm-123","rootFolderId":"folder-root-1"}',
      'Drive User'
    );
  });
});
