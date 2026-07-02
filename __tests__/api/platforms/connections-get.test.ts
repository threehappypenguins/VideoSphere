/**
 * Tests for GET /api/platforms/connections
 *
 * Covers: unauthenticated requests, DB errors, and successful
 * return of the user's connected platform accounts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mock connected-accounts repository
// ---------------------------------------------------------------------------

vi.mock('@/lib/platforms/connected-accounts-health', () => ({
  getConnectedAccountsWithHealth: vi.fn(),
}));

const mockGetAuthenticatedUserId = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

import { GET } from '@/app/api/platforms/connections/route';
import { getConnectedAccountsWithHealth } from '@/lib/platforms/connected-accounts-health';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = 'user-abc';
const SESSION_COOKIE = 'videosphere_session';

function makeRequest(cookies: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/platforms/connections');
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return new NextRequest(url, {
    method: 'GET',
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
  });
}

const MOCK_ACCOUNT = {
  id: 'conn-1',
  userId: USER_ID,
  platform: 'youtube',
  platformUserId: 'yt-user-123',
  platformName: 'Test Channel',
  tokenExpiry: new Date(Date.now() + 1_000_000).toISOString(),
  hasRefreshToken: true,
  hasYoutubeMainStreamKey: false,
  hasYoutubeTempStreamKey: false,
  connectionStatus: 'connected' as const,
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockGetAuthenticatedUserId.mockResolvedValue(USER_ID);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/platforms/connections', () => {
  describe('authentication', () => {
    it('returns 401 when no session cookie is present', async () => {
      mockGetAuthenticatedUserId.mockResolvedValueOnce(null);
      const res = await GET(makeRequest());
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 401 when the session is invalid', async () => {
      mockGetAuthenticatedUserId.mockResolvedValueOnce(null);
      const res = await GET(makeRequest({ [SESSION_COOKIE]: 'bad-token' }));
      expect(res.status).toBe(401);
    });

    it('does not call repository when unauthenticated', async () => {
      mockGetAuthenticatedUserId.mockResolvedValueOnce(null);
      await GET(makeRequest());
      expect(getConnectedAccountsWithHealth).not.toHaveBeenCalled();
    });
  });

  describe('success path', () => {
    it('returns 200 with account list', async () => {
      vi.mocked(getConnectedAccountsWithHealth).mockResolvedValueOnce([MOCK_ACCOUNT as never]);
      const res = await GET(makeRequest({ [SESSION_COOKIE]: 'valid-session' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe('conn-1');
    });

    it('calls repository with the authenticated userId', async () => {
      vi.mocked(getConnectedAccountsWithHealth).mockResolvedValueOnce([]);
      await GET(makeRequest({ [SESSION_COOKIE]: 'valid-session' }));
      expect(getConnectedAccountsWithHealth).toHaveBeenCalledWith(USER_ID);
    });

    it('returns 200 with empty array when user has no connections', async () => {
      vi.mocked(getConnectedAccountsWithHealth).mockResolvedValueOnce([]);
      const res = await GET(makeRequest({ [SESSION_COOKIE]: 'valid-session' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual([]);
    });

    it('returns 200 with multiple accounts', async () => {
      const second = { ...MOCK_ACCOUNT, id: 'conn-2', platform: 'vimeo' };
      vi.mocked(getConnectedAccountsWithHealth).mockResolvedValueOnce([
        MOCK_ACCOUNT as never,
        second as never,
      ]);
      const res = await GET(makeRequest({ [SESSION_COOKIE]: 'valid-session' }));
      const body = await res.json();
      expect(body.data).toHaveLength(2);
    });

    it('returns sermon_audio in the connections list', async () => {
      const sermonAudioAccount = {
        ...MOCK_ACCOUNT,
        id: 'conn-sa',
        platform: 'sermon_audio',
        platformUserId: 'broadcaster-99',
        platformName: 'My Church',
        hasRefreshToken: false,
        hasYoutubeMainStreamKey: false,
        hasYoutubeTempStreamKey: false,
      };
      vi.mocked(getConnectedAccountsWithHealth).mockResolvedValueOnce([
        sermonAudioAccount as never,
      ]);
      const res = await GET(makeRequest({ [SESSION_COOKIE]: 'valid-session' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual([
        expect.objectContaining({
          id: 'conn-sa',
          platform: 'sermon_audio',
          platformUserId: 'broadcaster-99',
          platformName: 'My Church',
        }),
      ]);
    });
  });

  describe('error handling', () => {
    it('returns 500 when the repository throws', async () => {
      vi.mocked(getConnectedAccountsWithHealth).mockRejectedValueOnce(new Error('DB error'));
      const res = await GET(makeRequest({ [SESSION_COOKIE]: 'valid-session' }));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Internal Server Error');
    });
  });
});
