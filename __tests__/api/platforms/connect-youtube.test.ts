/**
 * Tests for GET /api/platforms/connect/youtube
 *
 * Covers: missing env vars, unauthenticated requests, invalid sessions,
 * and successful redirect to Google OAuth consent screen.
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

import { GET } from '@/app/api/platforms/connect/youtube/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_COOKIE = 'a_session_test-project';

function makeRequest(cookies: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/platforms/connect/youtube');
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

describe('GET /api/platforms/connect/youtube', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT = 'http://localhost/v1';
    process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID = 'test-project';
    process.env.YOUTUBE_CLIENT_ID = 'test-yt-client-id';
  });

  afterEach(() => {
    delete process.env.YOUTUBE_CLIENT_ID;
  });

  describe('Missing environment variables', () => {
    it('redirects to ?error=youtube when YOUTUBE_CLIENT_ID is missing', async () => {
      delete process.env.YOUTUBE_CLIENT_ID;
      const req = makeRequest({ [SESSION_COOKIE]: 'valid-session' });
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=youtube');
    });

    it('redirects to ?error=youtube when NEXT_PUBLIC_APPWRITE_ENDPOINT is missing', async () => {
      delete process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
      const req = makeRequest({ [SESSION_COOKIE]: 'valid-session' });
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=youtube');
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

    it('redirects to /login when Appwrite rejects the session', async () => {
      mockAccountGet.mockRejectedValueOnce(new Error('Invalid session'));
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

    it('redirects to Google OAuth consent screen', async () => {
      const req = makeRequest({ [SESSION_COOKIE]: 'valid-session' });
      const res = await GET(req);
      expect(res.status).toBe(307);
      const location = res.headers.get('location')!;
      expect(location).toContain('accounts.google.com/o/oauth2/v2/auth');
    });

    it('includes the correct client_id in the redirect URL', async () => {
      const req = makeRequest({ [SESSION_COOKIE]: 'valid-session' });
      const res = await GET(req);
      const location = res.headers.get('location')!;
      expect(location).toContain('client_id=test-yt-client-id');
    });

    it('includes youtube.upload scope', async () => {
      const req = makeRequest({ [SESSION_COOKIE]: 'valid-session' });
      const res = await GET(req);
      const location = new URL(res.headers.get('location')!);
      expect(decodeURIComponent(location.searchParams.get('scope')!)).toContain('youtube.upload');
    });

    it('includes youtube.readonly scope', async () => {
      const req = makeRequest({ [SESSION_COOKIE]: 'valid-session' });
      const res = await GET(req);
      const location = new URL(res.headers.get('location')!);
      expect(decodeURIComponent(location.searchParams.get('scope')!)).toContain('youtube.readonly');
    });

    it('uses a random hex nonce (not userId) as the state parameter', async () => {
      const req = makeRequest({ [SESSION_COOKIE]: 'valid-session' });
      const res = await GET(req);
      const location = new URL(res.headers.get('location')!);
      const state = location.searchParams.get('state')!;
      // Should be a 64-character hex string, not the userId
      expect(state).toMatch(/^[0-9a-f]{64}$/);
      expect(state).not.toBe('user-123');
    });

    it('sets the CSRF nonce cookie on the response', async () => {
      const req = makeRequest({ [SESSION_COOKIE]: 'valid-session' });
      const res = await GET(req);
      const setCookie = res.headers.get('set-cookie') ?? '';
      expect(setCookie).toContain('youtube_oauth_state=');
      expect(setCookie).toContain('HttpOnly');
    });

    it('requests offline access for a refresh token', async () => {
      const req = makeRequest({ [SESSION_COOKIE]: 'valid-session' });
      const res = await GET(req);
      const location = new URL(res.headers.get('location')!);
      expect(location.searchParams.get('access_type')).toBe('offline');
    });
  });
});
