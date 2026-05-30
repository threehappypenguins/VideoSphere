/**
 * Tests for GET /api/auth/profile route.
 *
 * Verifies authentication gating and correct profile response.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const getAuthenticatedUserIdMock = vi.hoisted(() => vi.fn());
const getUserByIdMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => getAuthenticatedUserIdMock(...args),
}));

vi.mock('@/lib/repositories/users', () => ({
  getUserById: getUserByIdMock,
}));

import { GET } from '@/app/api/auth/profile/route';

function createRequest(cookies?: Record<string, string>): NextRequest {
  const cookieHeader = cookies
    ? Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')
    : '';

  return new NextRequest(new URL('http://localhost:3000/api/auth/profile'), {
    method: 'GET',
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
  });
}

describe('GET /api/auth/profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockResolvedValue('user_123');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 when session cookie is missing', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce(null);
    const res = await GET(createRequest());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Not authenticated' });
    expect(getUserByIdMock).not.toHaveBeenCalled();
  });

  it('returns 404 when user profile is not found', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user_123');
    getUserByIdMock.mockResolvedValueOnce(null);

    const res = await GET(createRequest({ videosphere_session: 'session-secret' }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Profile not found' });
  });

  it('returns user profile with isSupporter status', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user_123');
    getUserByIdMock.mockResolvedValueOnce({
      userId: 'user_123',
      email: 'test@example.com',
      isSupporter: true,
      role: 'user',
      $createdAt: '2026-01-01T00:00:00.000Z',
      $updatedAt: '2026-03-25T00:00:00.000Z',
    });

    const res = await GET(createRequest({ videosphere_session: 'session-secret' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe('user_123');
    expect(body.email).toBe('test@example.com');
    expect(body.isSupporter).toBe(true);
    expect(body.role).toBe('user');
  });

  it('returns free-tier user profile correctly', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user_456');
    getUserByIdMock.mockResolvedValueOnce({
      userId: 'user_456',
      email: 'free@example.com',
      isSupporter: false,
      role: 'user',
      $createdAt: '2026-02-01T00:00:00.000Z',
      $updatedAt: '2026-03-01T00:00:00.000Z',
    });

    const res = await GET(createRequest({ videosphere_session: 'session-secret' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isSupporter).toBe(false);
  });
});
