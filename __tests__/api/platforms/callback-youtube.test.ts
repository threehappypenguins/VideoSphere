/**
 * Tests for GET /api/platforms/callback/youtube
 *
 * Covers: missing env vars, OAuth error param, missing code/state,
 * CSRF state mismatch, missing/invalid Appwrite session,
 * failed token exchange, failed channel fetch, no channel found,
 * and the full success path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mock node-appwrite Client + Account
// ---------------------------------------------------------------------------

const mockAccountGet = vi.fn();

vi.mock('node-appwrite', () => {
  const mockClient = {
    setEndpoint: vi.fn(function () {
      return this;
    }),
    setProject: vi.fn(function () {
      return this;
    }),
    setSession: vi.fn(function () {
      return this;
    }),
  };
  function MockClient() {
    return mockClient;
  }
  function MockAccount() {
    this.get = mockAccountGet;
  }
  return { Client: MockClient, Account: MockAccount };
});

// ---------------------------------------------------------------------------
// Mock connected-accounts repository
// ---------------------------------------------------------------------------

vi.mock('@/lib/repositories/connected-accounts', () => ({
  createConnectedAccount: vi.fn(),
  getConnectedAccount: vi.fn(),
  updateTokens: vi.fn(),
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
  updateTokens,
} from '@/lib/repositories/connected-accounts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CSRF_NONCE = 'a'.repeat(64); // fixed hex nonce for tests
const CSRF_COOKIE = 'youtube_oauth_state';
const SESSION_COOKIE = 'a_session_test-project';

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

/** Returns cookies for a request that passes both CSRF and session checks. */
function validCookies(sessionToken = 'valid-session-token') {
  return { [CSRF_COOKIE]: CSRF_NONCE, [SESSION_COOKIE]: sessionToken };
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
    process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT = 'http://localhost/v1';
    process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID = 'test-project';
    // Default: Appwrite session resolves to user-1
    mockAccountGet.mockResolvedValue({ $id: 'user-1' });
  });

  afterEach(() => {
    delete process.env.YOUTUBE_CLIENT_ID;
    delete process.env.YOUTUBE_CLIENT_SECRET;
    delete process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
    delete process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
  });

  describe('Missing environment variables', () => {
    it('redirects to ?error=youtube when YOUTUBE_CLIENT_ID is missing', async () => {
      delete process.env.YOUTUBE_CLIENT_ID;
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=youtube');
    });

    it('redirects to ?error=youtube when YOUTUBE_CLIENT_SECRET is missing', async () => {
      delete process.env.YOUTUBE_CLIENT_SECRET;
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=youtube');
    });

    it('redirects to ?error=youtube when NEXT_PUBLIC_APPWRITE_ENDPOINT is missing', async () => {
      delete process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=youtube');
    });
  });

  describe('OAuth error param', () => {
    it('redirects to ?error=youtube when Google returns an error param', async () => {
      const req = makeRequest({ error: 'access_denied', state: CSRF_NONCE }, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=youtube');
    });
  });

  describe('Missing query params', () => {
    it('redirects to ?error=youtube when code is missing', async () => {
      const req = makeRequest({ state: CSRF_NONCE }, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=youtube');
    });

    it('redirects to ?error=youtube when state is missing', async () => {
      const req = makeRequest({ code: 'abc' }, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=youtube');
    });
  });

  describe('CSRF verification', () => {
    it('redirects to ?error=youtube when CSRF cookie is absent', async () => {
      const req = makeRequest(VALID_PARAMS, { [SESSION_COOKIE]: 'valid-session-token' });
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=youtube');
    });

    it('redirects to ?error=youtube when state param does not match CSRF cookie', async () => {
      const req = makeRequest(
        { code: 'abc', state: 'wrong-nonce' },
        { [CSRF_COOKIE]: CSRF_NONCE, [SESSION_COOKIE]: 'valid-session-token' }
      );
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=youtube');
    });
  });

  describe('Session verification', () => {
    it('redirects to /login when session cookie is absent', async () => {
      const req = makeRequest(VALID_PARAMS, { [CSRF_COOKIE]: CSRF_NONCE });
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toMatch(/\/login$/);
    });

    it('redirects to /login when Appwrite rejects the session', async () => {
      mockAccountGet.mockRejectedValueOnce(new Error('Invalid session'));
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toMatch(/\/login$/);
    });
  });

  describe('Token exchange failure', () => {
    it('redirects to ?error=youtube when token endpoint returns non-OK', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'invalid_grant',
      });
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=youtube');
    });

    it('redirects to ?error=youtube when token response has no access_token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token_type: 'Bearer', expires_in: 3600 }),
      });
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=youtube');
    });
  });

  describe('Channel fetch failure', () => {
    it('redirects to ?error=youtube when channels API returns non-OK', async () => {
      mockFetchSequence(200, TOKEN_RESPONSE, 403, { error: { message: 'Forbidden' } });
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=youtube');
    });

    it('redirects to ?error=youtube when channel list is empty', async () => {
      mockFetchSequence(200, TOKEN_RESPONSE, 200, { items: [] });
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=youtube');
    });
  });

  describe('Success path', () => {
    beforeEach(() => {
      mockFetchSequence(200, TOKEN_RESPONSE, 200, CHANNEL_RESPONSE);
      // Default: no existing connection (first-time connect)
      vi.mocked(getConnectedAccount).mockResolvedValue(null);
      vi.mocked(createConnectedAccount).mockResolvedValue({
        id: 'account-1',
        userId: 'user-1',
        platform: 'youtube',
        tokenExpiry: new Date(Date.now() + 3600 * 1000).toISOString(),
        platformUserId: 'UCtest123',
        platformName: 'My Test Channel',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });

    it('redirects to ?success=youtube', async () => {
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('success=youtube');
    });

    it('calls createConnectedAccount with userId from the Appwrite session (not state)', async () => {
      const req = makeRequest(VALID_PARAMS, validCookies());
      await GET(req);
      expect(createConnectedAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1', // from mockAccountGet, not from state param
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
      // Cookie should be deleted (Max-Age=0 or expires in the past)
      expect(setCookie).toMatch(/youtube_oauth_state=;|youtube_oauth_state=.*Max-Age=0/);
    });
  });

  describe('Reconnection (existing account)', () => {
    const EXISTING_ACCOUNT = {
      id: 'account-existing',
      userId: 'user-1',
      platform: 'youtube' as const,
      tokenExpiry: new Date(Date.now() + 3600 * 1000).toISOString(),
      platformUserId: 'UCtest123',
      platformName: 'My Test Channel',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    beforeEach(() => {
      mockFetchSequence(200, TOKEN_RESPONSE, 200, CHANNEL_RESPONSE);
      vi.mocked(getConnectedAccount).mockResolvedValue(EXISTING_ACCOUNT);
      vi.mocked(updateTokens).mockResolvedValue(EXISTING_ACCOUNT);
    });

    it('calls updateTokens instead of createConnectedAccount when account already exists', async () => {
      const req = makeRequest(VALID_PARAMS, validCookies());
      await GET(req);
      expect(updateTokens).toHaveBeenCalledWith(
        'account-existing',
        TOKEN_RESPONSE.access_token,
        TOKEN_RESPONSE.refresh_token,
        expect.any(String)
      );
      expect(createConnectedAccount).not.toHaveBeenCalled();
    });

    it('still redirects to ?success=youtube on reconnect', async () => {
      const req = makeRequest(VALID_PARAMS, validCookies());
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('success=youtube');
    });
  });
});
