/**
 * Tests for GET /api/platforms/callback/vimeo
 *
 * Covers: missing env vars, OAuth error param, missing code/state,
 * failed token exchange, missing user object in token response,
 * and the full success path (token storage + redirect).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mock connected-accounts repository
// ---------------------------------------------------------------------------

vi.mock('@/lib/repositories/connected-accounts', () => ({
  createConnectedAccount: vi.fn(),
  getConnectedAccount: vi.fn(),
  updateConnection: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { GET } from '@/app/api/platforms/callback/vimeo/route';
import {
  createConnectedAccount,
  getConnectedAccount,
  updateConnection,
} from '@/lib/repositories/connected-accounts';
// VIMEO_OAUTH_STATE_COOKIE imported for reference — cookie name used directly in test helpers

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = 'user-1';
const CSRF_NONCE = 'b'.repeat(64); // fixed hex nonce for tests
const CSRF_COOKIE = 'vimeo_oauth_state';
const VALID_COOKIE_VALUE = `${CSRF_NONCE}|${USER_ID}`;

function makeRequest(
  params: Record<string, string> = {},
  cookies: Record<string, string> = {}
): NextRequest {
  const url = new URL('http://localhost:3000/api/platforms/callback/vimeo');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return new NextRequest(url, {
    method: 'GET',
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
  });
}

function validCookies() {
  return { [CSRF_COOKIE]: VALID_COOKIE_VALUE };
}

const VALID_PARAMS = { code: 'auth-code', state: CSRF_NONCE };

const TOKEN_RESPONSE = {
  access_token: 'test-vimeo-access-token',
  token_type: 'bearer',
  scope: 'upload edit public private',
  user: {
    name: 'Test Vimeo User',
    uri: '/users/987654321',
  },
};

function mockTokenSuccess(body: unknown = TOKEN_RESPONSE) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

function mockTokenFailure(status = 400, body = 'invalid_grant') {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({ error: body }),
    text: async () => body,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/platforms/callback/vimeo', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.VIMEO_CLIENT_ID = 'test-client-id';
    process.env.VIMEO_CLIENT_SECRET = 'test-client-secret';
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.VIMEO_CLIENT_ID;
    delete process.env.VIMEO_CLIENT_SECRET;
  });

  describe('Missing environment variables', () => {
    it('returns HTML that navigates to ?error=vimeo when VIMEO_CLIENT_ID is missing', async () => {
      delete process.env.VIMEO_CLIENT_ID;
      const req = makeRequest(VALID_PARAMS);
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('error=vimeo');
    });

    it('returns HTML that navigates to ?error=vimeo when VIMEO_CLIENT_SECRET is missing', async () => {
      delete process.env.VIMEO_CLIENT_SECRET;
      const req = makeRequest(VALID_PARAMS);
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('error=vimeo');
    });
  });

  describe('OAuth error param', () => {
    it('returns HTML that navigates to ?error=vimeo when Vimeo returns an error param', async () => {
      const req = makeRequest({ error: 'access_denied', state: CSRF_NONCE }, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('error=vimeo');
    });
  });

  describe('Missing query params', () => {
    it('returns HTML that navigates to ?error=vimeo when code is missing', async () => {
      const req = makeRequest({ state: CSRF_NONCE }, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('error=vimeo');
    });

    it('returns HTML that navigates to ?error=vimeo when state is missing', async () => {
      const req = makeRequest({ code: 'abc' }, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('error=vimeo');
    });
  });

  describe('CSRF verification', () => {
    it('returns HTML that navigates to ?error=vimeo when CSRF cookie is absent', async () => {
      const req = makeRequest(VALID_PARAMS, {});
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('error=vimeo');
    });

    it('returns HTML that navigates to ?error=vimeo when state param does not match CSRF cookie nonce', async () => {
      const req = makeRequest(
        { code: 'abc', state: 'wrong-nonce' },
        { [CSRF_COOKIE]: VALID_COOKIE_VALUE }
      );
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('error=vimeo');
    });

    it('returns HTML that navigates to ?error=vimeo when cookie is malformed (no pipe separator)', async () => {
      const req = makeRequest(VALID_PARAMS, { [CSRF_COOKIE]: CSRF_NONCE }); // missing |userId
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('error=vimeo');
    });
  });

  describe('Token exchange', () => {
    it('returns HTML that navigates to ?error=vimeo when token endpoint returns non-OK', async () => {
      mockTokenFailure(400);
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('error=vimeo');
    });

    it('returns HTML that navigates to ?error=vimeo when token response has no access_token', async () => {
      mockTokenSuccess({
        token_type: 'bearer',
        scope: TOKEN_RESPONSE.scope,
        user: TOKEN_RESPONSE.user,
      });
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('error=vimeo');
    });

    it('returns HTML that navigates to ?error=vimeo when upload scope is missing', async () => {
      mockTokenSuccess({ ...TOKEN_RESPONSE, scope: 'public private' });
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('error=vimeo');
    });

    it('returns HTML that navigates to ?error=vimeo when token response has no user object', async () => {
      mockTokenSuccess({ access_token: 'tok', token_type: 'bearer', scope: 'public' });
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('error=vimeo');
    });

    it('sends a JSON body (not form-encoded) to the token endpoint', async () => {
      mockTokenSuccess();
      vi.mocked(createConnectedAccount).mockResolvedValue({
        id: 'acct-1',
        userId: USER_ID,
        platform: 'vimeo',
        tokenExpiry: new Date().toISOString(),
        hasRefreshToken: false,
        hasYoutubeMainStreamKey: false,
        hasYoutubeTempStreamKey: false,
        platformUserId: '987654321',
        platformName: 'Test Vimeo User',
        $createdAt: new Date().toISOString(),
        $updatedAt: new Date().toISOString(),
      });
      await GET(makeRequest(VALID_PARAMS, validCookies()));

      const [, fetchOptions] = mockFetch.mock.calls[0];
      expect(fetchOptions.headers['Content-Type']).toBe('application/json');
      expect(typeof fetchOptions.body).toBe('string');
      const body = JSON.parse(fetchOptions.body);
      expect(body.grant_type).toBe('authorization_code');
      expect(body.code).toBe('auth-code');
    });

    it('uses Basic auth (base64 clientId:clientSecret) for the token request', async () => {
      mockTokenSuccess();
      vi.mocked(createConnectedAccount).mockResolvedValue({
        id: 'acct-1',
        userId: USER_ID,
        platform: 'vimeo',
        tokenExpiry: new Date().toISOString(),
        hasRefreshToken: false,
        hasYoutubeMainStreamKey: false,
        hasYoutubeTempStreamKey: false,
        platformUserId: '987654321',
        platformName: 'Test Vimeo User',
        $createdAt: new Date().toISOString(),
        $updatedAt: new Date().toISOString(),
      });
      await GET(makeRequest(VALID_PARAMS, validCookies()));

      const [, fetchOptions] = mockFetch.mock.calls[0];
      const expectedCredentials = Buffer.from('test-client-id:test-client-secret').toString(
        'base64'
      );
      expect(fetchOptions.headers['Authorization']).toBe(`Basic ${expectedCredentials}`);
    });
  });

  describe('Success path', () => {
    beforeEach(() => {
      mockTokenSuccess();
      vi.mocked(getConnectedAccount).mockResolvedValue(null);
      vi.mocked(createConnectedAccount).mockResolvedValue({
        id: 'acct-1',
        userId: USER_ID,
        platform: 'vimeo',
        tokenExpiry: new Date().toISOString(),
        hasRefreshToken: false,
        hasYoutubeMainStreamKey: false,
        hasYoutubeTempStreamKey: false,
        platformUserId: '987654321',
        platformName: 'Test Vimeo User',
        $createdAt: new Date().toISOString(),
        $updatedAt: new Date().toISOString(),
      });
    });

    it('returns HTML that navigates to ?success=vimeo', async () => {
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('success=vimeo');
    });

    it('calls createConnectedAccount with userId from the CSRF cookie (not state param)', async () => {
      const req = makeRequest(VALID_PARAMS, validCookies());
      await GET(req);
      expect(createConnectedAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_ID,
          platform: 'vimeo',
          accessToken: TOKEN_RESPONSE.access_token,
        })
      );
    });

    it('extracts platformUserId from the user URI', async () => {
      const req = makeRequest(VALID_PARAMS, validCookies());
      await GET(req);
      expect(createConnectedAccount).toHaveBeenCalledWith(
        expect.objectContaining({ platformUserId: '987654321' })
      );
    });

    it('stores the user display name as platformName', async () => {
      const req = makeRequest(VALID_PARAMS, validCookies());
      await GET(req);
      expect(createConnectedAccount).toHaveBeenCalledWith(
        expect.objectContaining({ platformName: 'Test Vimeo User' })
      );
    });

    it('stores an empty refreshToken (Vimeo tokens do not use refresh tokens)', async () => {
      const req = makeRequest(VALID_PARAMS, validCookies());
      await GET(req);
      expect(createConnectedAccount).toHaveBeenCalledWith(
        expect.objectContaining({ refreshToken: '' })
      );
    });

    it('sets tokenExpiry approximately 10 years in the future', async () => {
      const before = Date.now();
      const req = makeRequest(VALID_PARAMS, validCookies());
      await GET(req);
      const after = Date.now();

      const call = vi.mocked(createConnectedAccount).mock.calls[0][0];
      const expiry = new Date(call.tokenExpiry).getTime();
      const tenYearsMs = 10 * 365 * 24 * 60 * 60 * 1000;
      expect(expiry).toBeGreaterThanOrEqual(before + tenYearsMs);
      expect(expiry).toBeLessThanOrEqual(after + tenYearsMs);
    });

    it('makes only one fetch call (no separate user info request)', async () => {
      const req = makeRequest(VALID_PARAMS, validCookies());
      await GET(req);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('clears the CSRF nonce cookie on success', async () => {
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      const setCookie = res.headers.get('set-cookie') ?? '';
      expect(setCookie).toMatch(/vimeo_oauth_state=;|vimeo_oauth_state=.*Max-Age=0/);
    });
  });

  describe('Unexpected errors', () => {
    it('returns HTML that navigates to ?error=vimeo when createConnectedAccount throws', async () => {
      mockTokenSuccess();
      vi.mocked(getConnectedAccount).mockResolvedValue(null);
      vi.mocked(createConnectedAccount).mockRejectedValueOnce(new Error('DB error'));
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('error=vimeo');
    });

    it('returns HTML that navigates to ?error=vimeo when fetch throws a network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('error=vimeo');
    });
  });

  describe('Reconnection (existing account)', () => {
    const EXISTING_ACCOUNT = {
      id: 'account-existing',
      userId: USER_ID,
      platform: 'vimeo' as const,
      tokenExpiry: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString(),
      hasRefreshToken: false,
      hasYoutubeMainStreamKey: false,
      hasYoutubeTempStreamKey: false,
      platformUserId: '987654321',
      platformName: 'Test Vimeo User',
      $createdAt: new Date().toISOString(),
      $updatedAt: new Date().toISOString(),
    };

    beforeEach(() => {
      mockTokenSuccess();
      vi.mocked(getConnectedAccount).mockResolvedValue(EXISTING_ACCOUNT);
      vi.mocked(updateConnection).mockResolvedValue(EXISTING_ACCOUNT);
    });

    it('calls updateConnection (not createConnectedAccount) when a connection already exists', async () => {
      const req = makeRequest(VALID_PARAMS, validCookies());
      await GET(req);
      expect(updateConnection).toHaveBeenCalledWith(
        'account-existing',
        TOKEN_RESPONSE.access_token,
        '', // empty refreshToken for Vimeo
        expect.any(String),
        '987654321',
        'Test Vimeo User'
      );
      expect(createConnectedAccount).not.toHaveBeenCalled();
    });

    it('still returns HTML that navigates to ?success=vimeo on reconnect', async () => {
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('success=vimeo');
    });
  });
});
