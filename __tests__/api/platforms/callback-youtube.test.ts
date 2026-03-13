/**
 * Tests for GET /api/platforms/callback/youtube
 *
 * Covers: missing env vars, OAuth error param, missing code/state,
 * failed token exchange, failed channel fetch, no channel found,
 * and the full success path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mock connected-accounts repository
// ---------------------------------------------------------------------------

vi.mock('@/lib/repositories/connected-accounts', () => ({
  createConnectedAccount: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { GET } from '@/app/api/platforms/callback/youtube/route';
import { createConnectedAccount } from '@/lib/repositories/connected-accounts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOKEN_RESPONSE = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  expires_in: 3600,
  token_type: 'Bearer',
};

const CHANNEL_RESPONSE = {
  items: [{ id: 'UCtest123', snippet: { title: 'My Test Channel' } }],
};

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/platforms/callback/youtube');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url, { method: 'GET' });
}

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
    it('redirects to ?error=youtube when YOUTUBE_CLIENT_ID is missing', async () => {
      delete process.env.YOUTUBE_CLIENT_ID;
      const req = makeRequest({ code: 'abc', state: 'user-1' });
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=youtube');
    });

    it('redirects to ?error=youtube when YOUTUBE_CLIENT_SECRET is missing', async () => {
      delete process.env.YOUTUBE_CLIENT_SECRET;
      const req = makeRequest({ code: 'abc', state: 'user-1' });
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=youtube');
    });
  });

  describe('OAuth error param', () => {
    it('redirects to ?error=youtube when Google returns an error param', async () => {
      const req = makeRequest({ error: 'access_denied', state: 'user-1' });
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=youtube');
    });
  });

  describe('Missing query params', () => {
    it('redirects to ?error=youtube when code is missing', async () => {
      const req = makeRequest({ state: 'user-1' });
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=youtube');
    });

    it('redirects to ?error=youtube when state (userId) is missing', async () => {
      const req = makeRequest({ code: 'abc' });
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=youtube');
    });
  });

  describe('Token exchange failure', () => {
    it('redirects to ?error=youtube when token endpoint returns non-OK', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'invalid_grant',
      });
      const req = makeRequest({ code: 'bad-code', state: 'user-1' });
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
      const req = makeRequest({ code: 'bad-code', state: 'user-1' });
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=youtube');
    });
  });

  describe('Channel fetch failure', () => {
    it('redirects to ?error=youtube when channels API returns non-OK', async () => {
      mockFetchSequence(200, TOKEN_RESPONSE, 403, { error: { message: 'Forbidden' } });
      const req = makeRequest({ code: 'abc', state: 'user-1' });
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=youtube');
    });

    it('redirects to ?error=youtube when channel list is empty', async () => {
      mockFetchSequence(200, TOKEN_RESPONSE, 200, { items: [] });
      const req = makeRequest({ code: 'abc', state: 'user-1' });
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=youtube');
    });
  });

  describe('Success path', () => {
    beforeEach(() => {
      mockFetchSequence(200, TOKEN_RESPONSE, 200, CHANNEL_RESPONSE);
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
      const req = makeRequest({ code: 'auth-code', state: 'user-1' });
      const res = await GET(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('success=youtube');
    });

    it('calls createConnectedAccount with correct platform and userId', async () => {
      const req = makeRequest({ code: 'auth-code', state: 'user-1' });
      await GET(req);
      expect(createConnectedAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
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
      const req = makeRequest({ code: 'auth-code', state: 'user-1' });
      await GET(req);
      const after = Date.now();

      const call = vi.mocked(createConnectedAccount).mock.calls[0][0];
      const expiry = new Date(call.tokenExpiry).getTime();
      expect(expiry).toBeGreaterThanOrEqual(before + 3600 * 1000);
      expect(expiry).toBeLessThanOrEqual(after + 3600 * 1000);
    });
  });
});
