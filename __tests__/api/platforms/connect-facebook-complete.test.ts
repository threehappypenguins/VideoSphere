/**
 * Tests for POST /api/platforms/connect/facebook/complete
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { encryptToken } from '@/lib/crypto/token-encryption';
import { FACEBOOK_SETUP_SESSION_COOKIE } from '@/lib/platforms/facebook-setup-session';
import { FACEBOOK_PAGE_TOKEN_EXPIRY_ISO } from '@/lib/platforms/facebook-oauth';

const mockGetAuthenticatedUserId = vi.fn();
const mockFetch = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

vi.mock('@/lib/repositories/connected-accounts', () => ({
  createConnectedAccount: vi.fn(),
  getConnectedAccountRowId: vi.fn(),
  getConnectedAccountWithTokens: vi.fn(),
  updateConnection: vi.fn(),
}));

import { POST } from '@/app/api/platforms/connect/facebook/complete/route';
import {
  createConnectedAccount,
  getConnectedAccountWithTokens,
  updateConnection,
} from '@/lib/repositories/connected-accounts';

function buildSetupSessionCookie(userId = 'user-1'): string {
  return encryptToken(
    JSON.stringify({
      userId,
      userAccessToken: 'long-user-token',
      userTokenExpiresIn: 5_184_000,
      userProfileId: 'fb-user-1',
      userProfileName: 'Test User',
    })
  );
}

function makeRequest(body: unknown, setupCookie?: string): NextRequest {
  const url = new URL('http://localhost:3000/api/platforms/connect/facebook/complete');
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(setupCookie ? { Cookie: `${FACEBOOK_SETUP_SESSION_COOKIE}=${setupCookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/platforms/connect/facebook/complete', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    mockGetAuthenticatedUserId.mockResolvedValue('user-1');
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'page-1', name: 'Test Page', access_token: 'resolved-page-token' }],
      }),
    });
    vi.mocked(createConnectedAccount).mockResolvedValue({
      id: 'acc-fb',
      userId: 'user-1',
      platform: 'facebook',
      tokenExpiry: '2099-01-01T00:00:00.000Z',
      hasRefreshToken: true,
      platformUserId: 'page-1',
      platformName: 'Test Page',
      $createdAt: '2020-01-01T00:00:00.000Z',
      $updatedAt: '2020-01-01T00:00:00.000Z',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves the Page access token via /me/accounts on complete', async () => {
    const req = makeRequest({ targetType: 'page', pageId: 'page-1' }, buildSetupSessionCookie());
    const res = await POST(req);
    const payload = (await res.json()) as { ok?: boolean };

    expect(res.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('graph.facebook.com/v25.0/me/accounts'),
      expect.objectContaining({
        cache: 'no-store',
        headers: expect.any(Headers),
      })
    );
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer long-user-token');
    expect(createConnectedAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'resolved-page-token',
        refreshToken: 'long-user-token',
        tokenExpiry: FACEBOOK_PAGE_TOKEN_EXPIRY_ISO,
        platformUserId: 'page-1',
      })
    );
  });

  it('returns connect-style error JSON when the setup session is missing', async () => {
    const req = makeRequest({ targetType: 'page', pageId: 'page-1' });
    const res = await POST(req);
    const payload = (await res.json()) as {
      ok?: boolean;
      error?: { code?: string; message?: string };
    };

    expect(res.status).toBe(400);
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe('FACEBOOK_SETUP_SESSION_EXPIRED');
    expect(payload.error?.message).toContain('setup session expired');
  });

  it('returns connect-style error JSON when updating a connection that no longer exists', async () => {
    vi.mocked(getConnectedAccountWithTokens).mockResolvedValue({
      id: 'acc-fb',
      userId: 'user-1',
      platform: 'facebook',
      accessToken: 'old-page-token',
      refreshToken: 'old-user-token',
      tokenExpiry: '2099-01-01T00:00:00.000Z',
      platformUserId: 'page-1',
      platformName: 'Old Page',
      facebookTargetType: 'page',
      facebookPageId: 'page-1',
      $createdAt: '2020-01-01T00:00:00.000Z',
      $updatedAt: '2020-01-01T00:00:00.000Z',
    });
    vi.mocked(updateConnection).mockResolvedValue(null);

    const req = makeRequest({ targetType: 'page', pageId: 'page-1' }, buildSetupSessionCookie());
    const res = await POST(req);
    const payload = (await res.json()) as {
      ok?: boolean;
      error?: { code?: string; message?: string };
    };

    expect(res.status).toBe(404);
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe('FACEBOOK_CONNECTION_NOT_FOUND');
    expect(createConnectedAccount).not.toHaveBeenCalled();
  });
});
