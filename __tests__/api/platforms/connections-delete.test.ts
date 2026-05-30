/**
 * Tests for DELETE /api/platforms/connections/[id]
 *
 * Covers: unauthenticated requests, IDOR protection (user can only delete
 * their own accounts), DB errors, and the successful 204 No Content path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mock connected-accounts repository
// ---------------------------------------------------------------------------

vi.mock('@/lib/repositories/connected-accounts', () => ({
  getConnectedAccountForUser: vi.fn(),
  deleteConnectedAccount: vi.fn(),
}));

const mockGetAuthenticatedUserId = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

import { DELETE } from '@/app/api/platforms/connections/[id]/route';
import {
  getConnectedAccountForUser,
  deleteConnectedAccount,
} from '@/lib/repositories/connected-accounts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = 'user-abc';
const SESSION_COOKIE = 'a_session_test-project';
const ACCOUNT_ID = 'conn-123';

function makeRequest(
  id: string,
  cookies: Record<string, string> = {}
): [NextRequest, { params: Promise<{ id: string }> }] {
  const url = new URL(`http://localhost:3000/api/platforms/connections/${id}`);
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  const req = new NextRequest(url, {
    method: 'DELETE',
    headers: {
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      'x-test-user-id': USER_ID,
    },
  });
  return [req, { params: Promise.resolve({ id }) }];
}

const MOCK_ACCOUNT = {
  id: ACCOUNT_ID,
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
  mockGetAuthenticatedUserId.mockImplementation(async (req: NextRequest) => {
    const token =
      req.cookies.get('videosphere_session')?.value ?? req.cookies.get(SESSION_COOKIE)?.value;
    if (!token || /bad|invalid|expired/i.test(token)) return null;
    return req.headers.get('x-test-user-id') || USER_ID;
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DELETE /api/platforms/connections/[id]', () => {
  describe('authentication', () => {
    it('returns 401 when no session cookie is present', async () => {
      const [req, ctx] = makeRequest(ACCOUNT_ID);
      const res = await DELETE(req, ctx);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 401 when the session is invalid', async () => {
      const [req, ctx] = makeRequest(ACCOUNT_ID, { [SESSION_COOKIE]: 'bad-token' });
      const res = await DELETE(req, ctx);
      expect(res.status).toBe(401);
    });

    it('does not call repository when unauthenticated', async () => {
      const [req, ctx] = makeRequest(ACCOUNT_ID);
      await DELETE(req, ctx);
      expect(getConnectedAccountForUser).not.toHaveBeenCalled();
      expect(deleteConnectedAccount).not.toHaveBeenCalled();
    });
  });

  describe('IDOR protection', () => {
    it('returns 404 when the account does not belong to the user (getConnectedAccountForUser returns null)', async () => {
      vi.mocked(getConnectedAccountForUser).mockResolvedValueOnce(null);
      const [req, ctx] = makeRequest('other-id', { [SESSION_COOKIE]: 'valid-session' });
      const res = await DELETE(req, ctx);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Not Found');
    });

    it('returns 404 when the account does not exist', async () => {
      vi.mocked(getConnectedAccountForUser).mockResolvedValueOnce(null);
      const [req, ctx] = makeRequest(ACCOUNT_ID, { [SESSION_COOKIE]: 'valid-session' });
      const res = await DELETE(req, ctx);
      expect(res.status).toBe(404);
    });

    it('does not call deleteConnectedAccount when account not owned by user', async () => {
      vi.mocked(getConnectedAccountForUser).mockResolvedValueOnce(null);
      const [req, ctx] = makeRequest('other-id', { [SESSION_COOKIE]: 'valid-session' });
      await DELETE(req, ctx);
      expect(deleteConnectedAccount).not.toHaveBeenCalled();
    });
  });

  describe('success path', () => {
    it('returns 204 No Content on successful deletion', async () => {
      vi.mocked(getConnectedAccountForUser).mockResolvedValueOnce(MOCK_ACCOUNT as never);
      vi.mocked(deleteConnectedAccount).mockResolvedValueOnce(undefined);
      const [req, ctx] = makeRequest(ACCOUNT_ID, { [SESSION_COOKIE]: 'valid-session' });
      const res = await DELETE(req, ctx);
      expect(res.status).toBe(204);
    });

    it('returns empty body on success', async () => {
      vi.mocked(getConnectedAccountForUser).mockResolvedValueOnce(MOCK_ACCOUNT as never);
      vi.mocked(deleteConnectedAccount).mockResolvedValueOnce(undefined);
      const [req, ctx] = makeRequest(ACCOUNT_ID, { [SESSION_COOKIE]: 'valid-session' });
      const res = await DELETE(req, ctx);
      const body = await res.text();
      expect(body).toBe('');
    });

    it('calls deleteConnectedAccount with the correct id', async () => {
      vi.mocked(getConnectedAccountForUser).mockResolvedValueOnce(MOCK_ACCOUNT as never);
      vi.mocked(deleteConnectedAccount).mockResolvedValueOnce(undefined);
      const [req, ctx] = makeRequest(ACCOUNT_ID, { [SESSION_COOKIE]: 'valid-session' });
      await DELETE(req, ctx);
      expect(deleteConnectedAccount).toHaveBeenCalledWith(ACCOUNT_ID);
    });

    it('calls getConnectedAccountForUser with the account id and authenticated userId', async () => {
      vi.mocked(getConnectedAccountForUser).mockResolvedValueOnce(MOCK_ACCOUNT as never);
      vi.mocked(deleteConnectedAccount).mockResolvedValueOnce(undefined);
      const [req, ctx] = makeRequest(ACCOUNT_ID, { [SESSION_COOKIE]: 'valid-session' });
      await DELETE(req, ctx);
      expect(getConnectedAccountForUser).toHaveBeenCalledWith(ACCOUNT_ID, USER_ID);
    });

    it('can delete any account owned by the user', async () => {
      const vimeoAccount = { ...MOCK_ACCOUNT, id: 'conn-456', platform: 'vimeo' };
      vi.mocked(getConnectedAccountForUser).mockResolvedValueOnce(vimeoAccount as never);
      vi.mocked(deleteConnectedAccount).mockResolvedValueOnce(undefined);
      const [req, ctx] = makeRequest('conn-456', { [SESSION_COOKIE]: 'valid-session' });
      const res = await DELETE(req, ctx);
      expect(res.status).toBe(204);
      expect(deleteConnectedAccount).toHaveBeenCalledWith('conn-456');
    });
  });

  describe('error handling', () => {
    it('returns 500 when getConnectedAccountForUser throws', async () => {
      vi.mocked(getConnectedAccountForUser).mockRejectedValueOnce(new Error('DB error'));
      const [req, ctx] = makeRequest(ACCOUNT_ID, { [SESSION_COOKIE]: 'valid-session' });
      const res = await DELETE(req, ctx);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Internal Server Error');
    });

    it('returns 500 when deleteConnectedAccount throws', async () => {
      vi.mocked(getConnectedAccountForUser).mockResolvedValueOnce(MOCK_ACCOUNT as never);
      vi.mocked(deleteConnectedAccount).mockRejectedValueOnce(new Error('Delete failed'));
      const [req, ctx] = makeRequest(ACCOUNT_ID, { [SESSION_COOKIE]: 'valid-session' });
      const res = await DELETE(req, ctx);
      expect(res.status).toBe(500);
    });
  });
});
