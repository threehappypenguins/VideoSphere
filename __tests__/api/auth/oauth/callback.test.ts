import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockUpsertOAuthUserByEmail = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());
const mockJwtSign = vi.hoisted(() => vi.fn().mockResolvedValue('jwt-token'));

vi.mock('@/lib/repositories/users', () => ({
  upsertOAuthUserByEmail: (...args: unknown[]) => mockUpsertOAuthUserByEmail(...args),
}));

vi.mock('jose', () => ({
  SignJWT: class {
    setProtectedHeader() {
      return this;
    }

    setSubject() {
      return this;
    }

    setIssuedAt() {
      return this;
    }

    setExpirationTime() {
      return this;
    }

    sign() {
      return mockJwtSign();
    }
  },
}));

vi.stubGlobal('fetch', mockFetch);

import { GOOGLE_AUTH_OAUTH_STATE_COOKIE } from '@/lib/auth/google-oauth';
import { GET } from '@/app/api/auth/oauth/callback/route';

function makeRequest(params: Record<string, string> = {}, cookies: Record<string, string> = {}) {
  const url = new URL('http://localhost:3000/api/auth/oauth/callback');
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const cookieHeader = Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
  return new NextRequest(url, {
    method: 'GET',
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
  });
}

function mockGoogleSuccess() {
  mockFetch
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'access-token' }),
      text: async () => JSON.stringify({ access_token: 'access-token' }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        sub: 'google-subject',
        email: 'creator@example.com',
        email_verified: true,
        name: 'Creator Name',
      }),
      text: async () =>
        JSON.stringify({
          sub: 'google-subject',
          email: 'creator@example.com',
          email_verified: true,
          name: 'Creator Name',
        }),
    });
}

function validRequest() {
  return makeRequest(
    { code: 'auth-code', state: 'nonce-123' },
    { [GOOGLE_AUTH_OAUTH_STATE_COOKIE]: 'nonce-123' }
  );
}

describe('GET /api/auth/oauth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    process.env.JWT_SECRET = 'test-jwt-secret-for-vitest-only';
  });

  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it('upserts via the users repository helper and redirects to dashboard', async () => {
    mockGoogleSuccess();
    mockUpsertOAuthUserByEmail.mockResolvedValueOnce({
      userId: 'generated-user-id',
      email: 'creator@example.com',
      name: 'Creator Name',
      hasCompletedOnboarding: false,
      role: 'user',
      $createdAt: '2026-01-01T00:00:00.000Z',
      $updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const res = await GET(validRequest());

    expect(mockUpsertOAuthUserByEmail).toHaveBeenCalledWith('creator@example.com', 'Creator Name');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3000/dashboard');
  });

  it('returns oauth_callback_failed when repository upsert fails', async () => {
    mockGoogleSuccess();
    mockUpsertOAuthUserByEmail.mockRejectedValueOnce(new Error('db unavailable'));

    const res = await GET(validRequest());

    expect(mockUpsertOAuthUserByEmail).toHaveBeenCalledWith('creator@example.com', 'Creator Name');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/login?error=oauth_callback_failed'
    );
  });
});
