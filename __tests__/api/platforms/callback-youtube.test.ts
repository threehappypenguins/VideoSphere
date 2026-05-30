/**
 * Tests for GET /api/platforms/callback/youtube
 *
 * Covers: missing env vars, OAuth error param, missing code/state,
 * CSRF state mismatch, malformed state cookie,
 * failed token exchange, failed channel fetch, no channel found,
 * reconnection upsert, and the full success path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { TokenDecryptError } from '@/lib/crypto/token-encryption';

// ---------------------------------------------------------------------------
// Mock connected-accounts repository
// ---------------------------------------------------------------------------

vi.mock('@/lib/repositories/connected-accounts', () => ({
  createConnectedAccount: vi.fn(),
  getConnectedAccount: vi.fn(),
  getConnectedAccountRowId: vi.fn(),
  getConnectedAccountWithTokens: vi.fn(),
  updateConnection: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { GET } from '@/app/api/platforms/callback/youtube/route';
import {
  createConnectedAccount,
  getConnectedAccount,
  getConnectedAccountRowId,
  getConnectedAccountWithTokens,
  updateConnection,
} from '@/lib/repositories/connected-accounts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CSRF_NONCE = 'a'.repeat(64); // fixed hex nonce for tests
const USER_ID = 'user-1';
const CSRF_COOKIE = 'youtube_oauth_state';
// Cookie value encodes both nonce and userId: "<nonce>|<userId>"
const VALID_COOKIE_VALUE = `${CSRF_NONCE}|${USER_ID}`;

function makeRequest(
  params: Record<string, string> = {},
  cookies: Record<string, string> = {}
): NextRequest {
  const url = new URL('http://localhost:3000/api/platforms/callback/youtube');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return new NextRequest(url, {
    method: 'GET',
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
  });
}

/** Returns cookies that pass the CSRF check, with userId embedded. */
function validCookies() {
  return { [CSRF_COOKIE]: VALID_COOKIE_VALUE };
}

/** Default params that pass CSRF check (state matches CSRF_NONCE). */
const VALID_PARAMS = { code: 'auth-code', state: CSRF_NONCE };

const TOKEN_RESPONSE = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  expires_in: 3600,
  token_type: 'Bearer',
};

const CHANNEL_RESPONSE = {
  items: [{ id: 'UCtest123', snippet: { title: 'My Test Channel' } }],
};

function mockFetchSequence(
  tokenStatus: number,
  tokenBody: unknown,
  channelStatus?: number,
  channelBody?: unknown
) {
  mockFetch
    .mockResolvedValueOnce({
      ok: tokenStatus >= 200 && tokenStatus < 300,
      status: tokenStatus,
      json: async () => tokenBody,
      text: async () => JSON.stringify(tokenBody),
    })
    .mockResolvedValueOnce({
      ok: (channelStatus ?? 200) >= 200 && (channelStatus ?? 200) < 300,
      status: channelStatus ?? 200,
      json: async () => channelBody ?? CHANNEL_RESPONSE,
      text: async () => JSON.stringify(channelBody ?? CHANNEL_RESPONSE),
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/platforms/callback/youtube', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.YOUTUBE_CLIENT_ID = 'test-client-id';
    process.env.YOUTUBE_CLIENT_SECRET = 'test-client-secret';
  });

  afterEach(() => {
    delete process.env.YOUTUBE_CLIENT_ID;
    delete process.env.YOUTUBE_CLIENT_SECRET;
  });

  describe('Missing environment variables', () => {
    it('returns HTML that navigates to ?error=youtube when YOUTUBE_CLIENT_ID is missing', async () => {
      delete process.env.YOUTUBE_CLIENT_ID;
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('error=youtube');
    });

    it('returns HTML that navigates to ?error=youtube when YOUTUBE_CLIENT_SECRET is missing', async () => {
      delete process.env.YOUTUBE_CLIENT_SECRET;
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('error=youtube');
    });
  });

  describe('OAuth error param', () => {
    it('returns HTML that navigates to ?error=youtube when Google returns an error param', async () => {
      const req = makeRequest({ error: 'access_denied', state: CSRF_NONCE }, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('error=youtube');
    });
  });

  describe('Missing query params', () => {
    it('returns HTML that navigates to ?error=youtube when code is missing', async () => {
      const req = makeRequest({ state: CSRF_NONCE }, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('error=youtube');
    });

    it('returns HTML that navigates to ?error=youtube when state is missing', async () => {
      const req = makeRequest({ code: 'abc' }, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('error=youtube');
    });
  });

  describe('CSRF verification', () => {
    it('returns HTML that navigates to ?error=youtube when CSRF cookie is absent', async () => {
      const req = makeRequest(VALID_PARAMS, {});
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('error=youtube');
    });

    it('returns HTML that navigates to ?error=youtube when state param does not match CSRF cookie nonce', async () => {
      const req = makeRequest(
        { code: 'abc', state: 'wrong-nonce' },
        { [CSRF_COOKIE]: VALID_COOKIE_VALUE }
      );
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('error=youtube');
    });

    it('returns HTML that navigates to ?error=youtube when cookie is malformed (no pipe separator)', async () => {
      const req = makeRequest(VALID_PARAMS, { [CSRF_COOKIE]: CSRF_NONCE }); // missing |userId
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('error=youtube');
    });
  });

  describe('Token exchange failure', () => {
    it('returns HTML that navigates to ?error=youtube when token endpoint returns non-OK', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'invalid_grant',
      });
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('error=youtube');
    });

    it('returns HTML that navigates to ?error=youtube when token response has no access_token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token_type: 'Bearer', expires_in: 3600 }),
      });
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('error=youtube');
    });
  });

  describe('Channel fetch failure', () => {
    it('returns HTML that navigates to ?error=youtube when channels API returns non-OK', async () => {
      mockFetchSequence(200, TOKEN_RESPONSE, 403, { error: { message: 'Forbidden' } });
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('error=youtube');
    });

    it('returns HTML that navigates to ?error=youtube when channel list is empty', async () => {
      mockFetchSequence(200, TOKEN_RESPONSE, 200, { items: [] });
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('error=youtube');
    });
  });

  describe('Success path', () => {
    beforeEach(() => {
      mockFetchSequence(200, TOKEN_RESPONSE, 200, CHANNEL_RESPONSE);
      vi.mocked(getConnectedAccountWithTokens).mockResolvedValue(null);
      vi.mocked(createConnectedAccount).mockResolvedValue({
        id: 'account-1',
        userId: USER_ID,
        platform: 'youtube',
        tokenExpiry: new Date(Date.now() + 3600 * 1000).toISOString(),
        hasRefreshToken: true,
        platformUserId: 'UCtest123',
        platformName: 'My Test Channel',
        $createdAt: new Date().toISOString(),
        $updatedAt: new Date().toISOString(),
      });
    });

    it('returns HTML that navigates to ?success=youtube', async () => {
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('success=youtube');
    });

    it('calls createConnectedAccount with userId from the CSRF cookie (not state param)', async () => {
      const req = makeRequest(VALID_PARAMS, validCookies());
      await GET(req);
      expect(createConnectedAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_ID,
          platform: 'youtube',
          platformUserId: 'UCtest123',
          platformName: 'My Test Channel',
          accessToken: TOKEN_RESPONSE.access_token,
          refreshToken: TOKEN_RESPONSE.refresh_token,
        })
      );
    });

    it('stores a tokenExpiry derived from expires_in', async () => {
      const before = Date.now();
      const req = makeRequest(VALID_PARAMS, validCookies());
      await GET(req);
      const after = Date.now();

      const call = vi.mocked(createConnectedAccount).mock.calls[0][0];
      const expiry = new Date(call.tokenExpiry).getTime();
      expect(expiry).toBeGreaterThanOrEqual(before + 3600 * 1000);
      expect(expiry).toBeLessThanOrEqual(after + 3600 * 1000);
    });

    it('clears the CSRF nonce cookie on success', async () => {
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      const setCookie = res.headers.get('set-cookie') ?? '';
      expect(setCookie).toMatch(/youtube_oauth_state=;|youtube_oauth_state=.*Max-Age=0/);
    });
  });

  describe('Reconnection (existing account)', () => {
    const EXISTING_ACCOUNT = {
      id: 'account-existing',
      userId: USER_ID,
      platform: 'youtube' as const,
      tokenExpiry: new Date(Date.now() + 3600 * 1000).toISOString(),
      hasRefreshToken: true,
      platformUserId: 'UCtest123',
      platformName: 'My Test Channel',
      $createdAt: new Date().toISOString(),
      $updatedAt: new Date().toISOString(),
    };

    beforeEach(() => {
      mockFetchSequence(200, TOKEN_RESPONSE, 200, CHANNEL_RESPONSE);
      vi.mocked(getConnectedAccount).mockResolvedValue(EXISTING_ACCOUNT);
      vi.mocked(getConnectedAccountWithTokens).mockResolvedValue({
        ...EXISTING_ACCOUNT,
        accessToken: 'existing-access-token',
        refreshToken: 'existing-refresh-token',
      });
      vi.mocked(updateConnection).mockResolvedValue(EXISTING_ACCOUNT);
    });

    it('calls updateConnection (not createConnectedAccount) with updated platform metadata', async () => {
      const req = makeRequest(VALID_PARAMS, validCookies());
      await GET(req);
      expect(updateConnection).toHaveBeenCalledWith(
        'account-existing',
        TOKEN_RESPONSE.access_token,
        TOKEN_RESPONSE.refresh_token,
        expect.any(String),
        'UCtest123',
        'My Test Channel'
      );
      expect(createConnectedAccount).not.toHaveBeenCalled();
    });

    it('still returns HTML that navigates to ?success=youtube on reconnect', async () => {
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('success=youtube');
    });

    it('preserves existing refresh token when token exchange omits refresh_token', async () => {
      mockFetch.mockReset();
      mockFetchSequence(
        200,
        { ...TOKEN_RESPONSE, refresh_token: undefined },
        200,
        CHANNEL_RESPONSE
      );

      const req = makeRequest(VALID_PARAMS, validCookies());
      await GET(req);

      expect(updateConnection).toHaveBeenCalledWith(
        'account-existing',
        TOKEN_RESPONSE.access_token,
        'existing-refresh-token',
        expect.any(String),
        'UCtest123',
        'My Test Channel'
      );
    });

    it('falls back to public account lookup when token decryption fails and still succeeds', async () => {
      vi.mocked(getConnectedAccountWithTokens).mockRejectedValue(
        new TokenDecryptError('Unsupported state or unable to authenticate data')
      );
      vi.mocked(getConnectedAccountRowId).mockResolvedValue({
        id: 'account-existing',
        platformUserId: 'UCtest123',
      });

      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);

      expect(updateConnection).toHaveBeenCalledWith(
        'account-existing',
        TOKEN_RESPONSE.access_token,
        TOKEN_RESPONSE.refresh_token,
        expect.any(String),
        'UCtest123',
        'My Test Channel'
      );
      expect(createConnectedAccount).not.toHaveBeenCalled();
      expect(await res.text()).toContain('success=youtube');
    });

    it('does not fallback on non-decrypt repository errors and returns error redirect', async () => {
      vi.mocked(getConnectedAccountWithTokens).mockRejectedValue(
        new Error('Data store list failed: ECONNRESET')
      );

      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);

      expect(getConnectedAccount).not.toHaveBeenCalled();
      expect(updateConnection).not.toHaveBeenCalled();
      expect(createConnectedAccount).not.toHaveBeenCalled();
      expect(await res.text()).toContain('error=youtube');
    });
  });
});
