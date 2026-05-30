import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { mockJwtVerify, mockGetUserById } = vi.hoisted(() => ({
  mockJwtVerify: vi.fn(),
  mockGetUserById: vi.fn(),
}));

vi.mock('jose', () => ({
  jwtVerify: (...args: unknown[]) => mockJwtVerify(...args),
}));

vi.mock('@/lib/repositories/users', () => ({
  getUserById: (...args: unknown[]) => mockGetUserById(...args),
}));

import { getAuthenticatedUserId } from '@/lib/api/auth';

function createRequest(cookies: Record<string, string> = {}): NextRequest {
  const cookieHeader = Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');

  return new NextRequest('http://localhost:3000/api/test', {
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
  });
}

describe('getAuthenticatedUserId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret';
    process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID = 'test-project';
  });

  it('returns user id when JWT is valid and user profile exists', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: { sub: 'user-1' } });
    mockGetUserById.mockResolvedValueOnce({ userId: 'user-1' });

    const userId = await getAuthenticatedUserId(
      createRequest({ videosphere_session: 'valid-jwt-token' })
    );

    expect(userId).toBe('user-1');
    expect(mockGetUserById).toHaveBeenCalledWith('user-1');
  });

  it('returns null when JWT is valid but user profile does not exist', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: { sub: 'deleted-user' } });
    mockGetUserById.mockResolvedValueOnce(null);

    const userId = await getAuthenticatedUserId(
      createRequest({ videosphere_session: 'valid-jwt-token' })
    );

    expect(userId).toBeNull();
    expect(mockGetUserById).toHaveBeenCalledWith('deleted-user');
  });

  it('returns null when JWT subject is missing', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: {} });

    const userId = await getAuthenticatedUserId(
      createRequest({ videosphere_session: 'valid-jwt-token' })
    );

    expect(userId).toBeNull();
    expect(mockGetUserById).not.toHaveBeenCalled();
  });

  it('preserves test-only legacy fallback when JWT verification fails', async () => {
    mockJwtVerify.mockRejectedValueOnce(new Error('invalid token'));

    const userId = await getAuthenticatedUserId(
      createRequest({
        videosphere_session: 'broken-jwt',
        'a_session_test-project': 'legacy-session-token',
      })
    );

    expect(userId).toBe('user-123');
  });
});
