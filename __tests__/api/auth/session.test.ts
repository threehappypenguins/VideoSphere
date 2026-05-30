import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getAuthenticatedUserIdMock = vi.hoisted(() => vi.fn());
const getUserByIdMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));

vi.mock('@/lib/repositories/users', () => ({
  getUserById: getUserByIdMock,
}));

import { GET } from '@/app/api/auth/session/route';

function makeRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/auth/session'), {
    method: 'GET',
  });
}

describe('GET /api/auth/session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the persisted profile name for authenticated users', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user-1');
    getUserByIdMock.mockResolvedValueOnce({
      userId: 'user-1',
      email: 'creator@example.com',
      name: 'Ada Lovelace',
      isSupporter: false,
      hasCompletedOnboarding: false,
      role: 'user',
      $createdAt: '2026-01-01T00:00:00.000Z',
      $updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      $id: 'user-1',
      email: 'creator@example.com',
      name: 'Ada Lovelace',
    });
  });
});
