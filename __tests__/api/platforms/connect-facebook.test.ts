/**
 * Tests for GET /api/platforms/connect/facebook
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedUserId = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

import { GET } from '@/app/api/platforms/connect/facebook/route';

const SESSION_COOKIE = 'videosphere_session';

function makeRequest(cookies: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/platforms/connect/facebook');
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return new NextRequest(url, {
    method: 'GET',
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
  });
}

describe('GET /api/platforms/connect/facebook', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.FACEBOOK_APP_ID = 'test-fb-app-id';
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    mockGetAuthenticatedUserId.mockImplementation(async (req: NextRequest) => {
      const token = req.cookies.get(SESSION_COOKIE)?.value;
      if (!token || /bad|invalid|expired/i.test(token)) return null;
      return 'user-123';
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.FACEBOOK_APP_ID;
  });

  it('redirects to ?error=facebook when FACEBOOK_APP_ID is missing', async () => {
    delete process.env.FACEBOOK_APP_ID;
    const req = makeRequest({ [SESSION_COOKIE]: 'valid-session' });
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('error=facebook');
  });

  it('redirects to /login when unauthenticated', async () => {
    const req = makeRequest();
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toMatch(/\/login$/);
  });

  it('redirects to Facebook OAuth dialog with required scopes', async () => {
    const req = makeRequest({ [SESSION_COOKIE]: 'valid-session' });
    const res = await GET(req);
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin + location.pathname).toBe('https://www.facebook.com/v25.0/dialog/oauth');
    expect(location.searchParams.get('client_id')).toBe('test-fb-app-id');
    const scope = location.searchParams.get('scope')!;
    expect(scope).toContain('pages_show_list');
    expect(scope).toContain('pages_manage_posts');
    expect(scope).not.toContain('publish_video');
  });

  it('sets the CSRF state cookie with nonce and userId', async () => {
    const req = makeRequest({ [SESSION_COOKIE]: 'valid-session' });
    const res = await GET(req);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/facebook_oauth_state=[0-9a-f]{64}%7Cuser-123/);
    expect(setCookie).toContain('HttpOnly');
  });
});
