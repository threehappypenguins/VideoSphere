import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getAuthenticatedSessionUserMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedSessionUser: getAuthenticatedSessionUserMock,
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

  it('returns the persisted profile name, auth provider, and totpEnabled for authenticated users', async () => {
    getAuthenticatedSessionUserMock.mockResolvedValueOnce({
      userId: 'user-1',
      email: 'creator@example.com',
      name: 'Ada Lovelace',
      hasCompletedOnboarding: false,
      role: 'user',
      authProvider: 'password',
      totpEnabled: false,
      $createdAt: '2026-01-01T00:00:00.000Z',
      $updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      $id: 'user-1',
      email: 'creator@example.com',
      name: 'Ada Lovelace',
      authProvider: 'password',
      totpEnabled: false,
      preferences: undefined,
      clockFormat: '12',
    });
  });

  it('returns 401 when session user lookup fails', async () => {
    getAuthenticatedSessionUserMock.mockRejectedValueOnce(new Error('db unavailable'));

    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Not authenticated' });
  });
});
