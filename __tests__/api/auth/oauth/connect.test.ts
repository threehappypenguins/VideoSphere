import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedSessionUserId = vi.hoisted(() => vi.fn());
const mockGetUserById = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedSessionUserId: (...args: unknown[]) => mockGetAuthenticatedSessionUserId(...args),
}));

vi.mock('@/lib/repositories/users', () => ({
  getUserById: (...args: unknown[]) => mockGetUserById(...args),
}));

const passwordProfile = {
  userId: 'user-abc',
  email: 'user@example.com',
  hasCompletedOnboarding: false,
  role: 'user' as const,
  authProvider: 'password' as const,
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:00:00.000Z',
};

import { GOOGLE_AUTH_OAUTH_STATE_COOKIE } from '@/lib/auth/google-oauth';
import { GET } from '@/app/api/auth/oauth/connect/route';

describe('GET /api/auth/oauth/connect', () => {
  const originalClientId = process.env.GOOGLE_CLIENT_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    mockGetAuthenticatedSessionUserId.mockResolvedValue('user-abc');
    mockGetUserById.mockResolvedValue(passwordProfile);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (originalClientId === undefined) {
      delete process.env.GOOGLE_CLIENT_ID;
    } else {
      process.env.GOOGLE_CLIENT_ID = originalClientId;
    }
  });

  it('redirects unauthenticated users to profile with an error', async () => {
    mockGetAuthenticatedSessionUserId.mockResolvedValueOnce(null);

    const res = await GET(new NextRequest('http://localhost:3000/api/auth/oauth/connect'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/profile?error=oauth_initiation_failed'
    );
  });

  it('redirects when the user profile no longer exists', async () => {
    mockGetUserById.mockResolvedValueOnce(null);

    const res = await GET(new NextRequest('http://localhost:3000/api/auth/oauth/connect'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/profile?error=oauth_initiation_failed'
    );
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('redirects when profile lookup throws', async () => {
    mockGetUserById.mockRejectedValueOnce(new Error('Database unavailable'));

    const res = await GET(new NextRequest('http://localhost:3000/api/auth/oauth/connect'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/profile?error=oauth_initiation_failed'
    );
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('redirects when Google is already linked', async () => {
    mockGetUserById.mockResolvedValueOnce({ ...passwordProfile, authProvider: 'google' });

    const res = await GET(new NextRequest('http://localhost:3000/api/auth/oauth/connect'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/profile?error=oauth_connect_already_linked'
    );
  });

  it('starts Google OAuth with connect state for password users', async () => {
    const res = await GET(new NextRequest('http://localhost:3000/api/auth/oauth/connect'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toMatch(
      /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/
    );

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${GOOGLE_AUTH_OAUTH_STATE_COOKIE}=`);
    expect(setCookie).toContain('connect');
    expect(setCookie).toContain('user-abc');
  });
});
