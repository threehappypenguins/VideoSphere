/**
 * Tests for GET /api/platforms/connect/vimeo
 *
 * Covers: missing env vars, unauthenticated requests, invalid sessions,
 * and successful redirect to Vimeo OAuth consent screen.
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

import { GET } from '@/app/api/platforms/connect/vimeo/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_COOKIE = 'a_session_test-project';

function makeRequest(cookies: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/platforms/connect/vimeo');
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return new NextRequest(url, {
    method: 'GET',
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/platforms/connect/vimeo', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT = 'http://localhost/v1';
    process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID = 'test-project';
    process.env.VIMEO_CLIENT_ID = 'test-vimeo-client-id';
  });

  afterEach(() => {
    delete process.env.VIMEO_CLIENT_ID;
  });

  describe('Missing environment variables', () => {
    it('redirects to ?error=vimeo when VIMEO_CLIENT_ID is missing', async () => {
      delete process.env.VIMEO_CLIENT_ID;
      const req = makeRequest({ [SESSION_COOKIE]: 'valid-session' });
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=vimeo');
    });

    it('still redirects to Vimeo OAuth when NEXT_PUBLIC_APPWRITE_ENDPOINT is missing', async () => {
      delete process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
      const req = makeRequest({ [SESSION_COOKIE]: 'valid-session' });
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('api.vimeo.com/oauth/authorize');
      process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT = 'http://localhost/v1';
    });
  });

  describe('Authentication', () => {
    it('redirects to /login when no session cookie is present', async () => {
      const req = makeRequest();
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toMatch(/\/login$/);
    });

    it('redirects to /login when the auth cookie is invalid', async () => {
      const req = makeRequest({ [SESSION_COOKIE]: 'bad-token' });
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toMatch(/\/login$/);
    });
  });

  describe('Successful redirect', () => {
    beforeEach(() => {
      mockAccountGet.mockResolvedValue({ $id: 'user-123' });
    });

    it('redirects to the Vimeo OAuth authorization URL', async () => {
      const req = makeRequest({ [SESSION_COOKIE]: 'valid-session' });
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('api.vimeo.com/oauth/authorize');
    });

    it('includes the correct client_id in the redirect URL', async () => {
      const req = makeRequest({ [SESSION_COOKIE]: 'valid-session' });
      const res = await GET(req);
      const location = new URL(res.headers.get('location')!);
      expect(location.searchParams.get('client_id')).toBe('test-vimeo-client-id');
    });

    it('uses a random hex nonce (not userId) as the state parameter', async () => {
      const req = makeRequest({ [SESSION_COOKIE]: 'valid-session' });
      const res = await GET(req);
      const location = new URL(res.headers.get('location')!);
      const state = location.searchParams.get('state')!;
      expect(state).toMatch(/^[0-9a-f]{64}$/);
      expect(state).not.toBe('user-123');
    });

    it('requests the code response_type', async () => {
      const req = makeRequest({ [SESSION_COOKIE]: 'valid-session' });
      const res = await GET(req);
      const location = new URL(res.headers.get('location')!);
      expect(location.searchParams.get('response_type')).toBe('code');
    });

    it('requests Vimeo upload and edit scopes', async () => {
      const req = makeRequest({ [SESSION_COOKIE]: 'valid-session' });
      const res = await GET(req);
      const location = new URL(res.headers.get('location')!);
      const scope = decodeURIComponent(location.searchParams.get('scope') || '');
      expect(scope).toContain('upload');
      expect(scope).toContain('edit');
    });

    it('sets the correct callback redirect_uri', async () => {
      const req = makeRequest({ [SESSION_COOKIE]: 'valid-session' });
      const res = await GET(req);
      const location = new URL(res.headers.get('location')!);
      expect(location.searchParams.get('redirect_uri')).toBe(
        'http://localhost:3000/api/platforms/callback/vimeo'
      );
    });

    it('sets the CSRF nonce cookie containing the nonce and userId on the response', async () => {
      const req = makeRequest({ [SESSION_COOKIE]: 'valid-session' });
      const res = await GET(req);
      const setCookie = res.headers.get('set-cookie') ?? '';
      // Cookie value format: "<64-char-hex-nonce>%7C<userId>" (pipe is URL-encoded)
      expect(setCookie).toMatch(/vimeo_oauth_state=[0-9a-f]{64}%7Cuser-123/);
      expect(setCookie).toContain('HttpOnly');
    });
  });
});
