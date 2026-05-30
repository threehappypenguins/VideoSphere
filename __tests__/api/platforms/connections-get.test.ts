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

vi.mock('@/lib/repositories/connected-accounts', () => ({
  getConnectedAccountsByUser: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock node-appwrite Client + Account (needed by getAuthenticatedUserId)
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

import { GET } from '@/app/api/platforms/connections/route';
import { getConnectedAccountsByUser } from '@/lib/repositories/connected-accounts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = 'user-abc';
const SESSION_COOKIE = 'a_session_test-project';

function makeRequest(cookies: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/platforms/connections');
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return new NextRequest(url, {
    method: 'GET',
    headers: {
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      'x-test-user-id': USER_ID,
    },
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
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APPWRITE_PROJECT_ID', 'test-project');
  vi.stubEnv('NEXT_PUBLIC_APPWRITE_ENDPOINT', 'https://appwrite.test/v1');
  mockAccountGet.mockResolvedValue({ $id: USER_ID });
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
      const res = await GET(makeRequest());
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 401 when the session is invalid', async () => {
      const res = await GET(makeRequest({ [SESSION_COOKIE]: 'bad-token' }));
      expect(res.status).toBe(401);
    });

    it('does not call repository when unauthenticated', async () => {
      await GET(makeRequest());
      expect(getConnectedAccountsByUser).not.toHaveBeenCalled();
    });
  });

  describe('success path', () => {
    it('returns 200 with account list', async () => {
      vi.mocked(getConnectedAccountsByUser).mockResolvedValueOnce([MOCK_ACCOUNT as never]);
      const res = await GET(makeRequest({ [SESSION_COOKIE]: 'valid-session' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe('conn-1');
    });

    it('calls repository with the authenticated userId', async () => {
      vi.mocked(getConnectedAccountsByUser).mockResolvedValueOnce([]);
      await GET(makeRequest({ [SESSION_COOKIE]: 'valid-session' }));
      expect(getConnectedAccountsByUser).toHaveBeenCalledWith(USER_ID);
    });

    it('returns 200 with empty array when user has no connections', async () => {
      vi.mocked(getConnectedAccountsByUser).mockResolvedValueOnce([]);
      const res = await GET(makeRequest({ [SESSION_COOKIE]: 'valid-session' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual([]);
    });

    it('returns 200 with multiple accounts', async () => {
      const second = { ...MOCK_ACCOUNT, id: 'conn-2', platform: 'vimeo' };
      vi.mocked(getConnectedAccountsByUser).mockResolvedValueOnce([
        MOCK_ACCOUNT as never,
        second as never,
      ]);
      const res = await GET(makeRequest({ [SESSION_COOKIE]: 'valid-session' }));
      const body = await res.json();
      expect(body.data).toHaveLength(2);
    });
  });

  describe('error handling', () => {
    it('returns 500 when the repository throws', async () => {
      vi.mocked(getConnectedAccountsByUser).mockRejectedValueOnce(new Error('DB error'));
      const res = await GET(makeRequest({ [SESSION_COOKIE]: 'valid-session' }));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Internal Server Error');
    });
  });
});
