/**
 * Tests for GET /api/platforms/callback/facebook
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockFetch = vi.fn();

import { GET } from '@/app/api/platforms/callback/facebook/route';

const CSRF_NONCE = 'b'.repeat(64);
const USER_ID = 'user-1';
const CSRF_COOKIE = 'facebook_oauth_state';
const VALID_COOKIE_VALUE = `${CSRF_NONCE}|${USER_ID}`;
const VALID_PARAMS = { code: 'auth-code', state: CSRF_NONCE };

function makeRequest(
  params: Record<string, string> = {},
  cookies: Record<string, string> = {}
): NextRequest {
  const url = new URL('http://localhost:3000/api/platforms/callback/facebook');
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

/**
 * Reads Set-Cookie header values from a response.
 * Uses `Headers.getSetCookie()` when available; otherwise falls back to `get('set-cookie')`.
 * @param headers - Response headers to inspect.
 * @returns Individual Set-Cookie header values.
 */
function getResponseSetCookies(headers: Headers): string[] {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === 'function') {
    return getSetCookie.call(headers);
  }
  const raw = headers.get('set-cookie');
  if (!raw) return [];
  return raw.split(/,(?=\s*[\w.-]+=)/).map((cookie) => cookie.trim());
}

function mockSuccessfulTokenFlow() {
  mockFetch
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'short-token', expires_in: 3600 }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'long-token', expires_in: 5184000 }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'fb-user-1', name: 'Test User' }),
    });
}

describe('GET /api/platforms/callback/facebook', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    process.env.FACEBOOK_APP_ID = 'test-app-id';
    process.env.FACEBOOK_APP_SECRET = 'test-app-secret';
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.FACEBOOK_APP_ID;
    delete process.env.FACEBOOK_APP_SECRET;
    vi.unstubAllGlobals();
  });

  it('returns HTML that navigates to ?error=facebook when env vars are missing', async () => {
    delete process.env.FACEBOOK_APP_ID;
    const req = makeRequest(VALID_PARAMS, validCookies());
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('error=facebook');
  });

  it('returns HTML that navigates to ?error=facebook when Facebook returns error param', async () => {
    const req = makeRequest({ error: 'access_denied', state: CSRF_NONCE }, validCookies());
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('error=facebook');
  });

  it('returns HTML that navigates to ?error=facebook on CSRF mismatch', async () => {
    const req = makeRequest({ code: 'abc', state: 'wrong' }, { [CSRF_COOKIE]: VALID_COOKIE_VALUE });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('error=facebook');
  });

  it('returns HTML that navigates to facebook-setup on success and sets setup session cookie', async () => {
    mockSuccessfulTokenFlow();
    const req = makeRequest(VALID_PARAMS, validCookies());
    const res = await GET(req);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('/profile/connections/facebook-setup');
    const setCookies = getResponseSetCookies(res.headers);
    expect(setCookies.some((cookie) => cookie.startsWith('facebook_setup_session='))).toBe(true);
    expect(setCookies.some((cookie) => cookie.startsWith('facebook_oauth_state='))).toBe(true);
  });

  it('returns HTML that navigates to ?error=facebook when token exchange fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: { message: 'invalid code' } }),
    });
    const req = makeRequest(VALID_PARAMS, validCookies());
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('error=facebook');
  });
});
