import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockConnectToDatabase = vi.hoisted(() => vi.fn());
const mockUpdateOne = vi.hoisted(() => vi.fn());
const mockFindOne = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());
const mockJwtSign = vi.hoisted(() => vi.fn().mockResolvedValue('jwt-token'));

vi.mock('@/lib/mongodb', () => ({
  connectToDatabase: (...args: unknown[]) => mockConnectToDatabase(...args),
}));

vi.mock('@/lib/models/UserProfile', () => ({
  UserProfileModel: {
    updateOne: (...args: unknown[]) => mockUpdateOne(...args),
    findOne: (...args: unknown[]) => mockFindOne(...args),
  },
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

import { GOOGLE_AUTH_OAUTH_STATE_COOKIE } from '@/app/api/auth/oauth/google/route';
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
      }),
      text: async () =>
        JSON.stringify({
          sub: 'google-subject',
          email: 'creator@example.com',
          email_verified: true,
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
    mockConnectToDatabase.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it('uses an atomic email-keyed upsert when creating the first profile', async () => {
    mockGoogleSuccess();
    mockUpdateOne.mockResolvedValueOnce({ acknowledged: true, matchedCount: 0, upsertedCount: 1 });
    mockFindOne.mockReturnValueOnce({
      lean: vi.fn().mockResolvedValue({
        _id: 'generated-user-id',
        userId: 'generated-user-id',
        email: 'creator@example.com',
        isSupporter: false,
        hasCompletedOnboarding: false,
        role: 'user',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    });

    const res = await GET(validRequest());

    expect(mockUpdateOne).toHaveBeenCalledWith(
      { email: 'creator@example.com' },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          email: 'creator@example.com',
          isSupporter: false,
          hasCompletedOnboarding: false,
          role: 'user',
        }),
      }),
      { upsert: true }
    );
    expect(mockFindOne).toHaveBeenCalledWith({ email: 'creator@example.com' });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3000/dashboard');
  });

  it('recovers from a duplicate-key race by reading the profile that the other callback created', async () => {
    mockGoogleSuccess();
    mockUpdateOne.mockRejectedValueOnce({ code: 11000 });
    mockFindOne.mockReturnValueOnce({
      lean: vi.fn().mockResolvedValue({
        _id: 'existing-user-id',
        userId: 'existing-user-id',
        email: 'creator@example.com',
        isSupporter: false,
        hasCompletedOnboarding: false,
        role: 'user',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    });

    const res = await GET(validRequest());

    expect(mockUpdateOne).toHaveBeenCalledTimes(1);
    expect(mockFindOne).toHaveBeenCalledWith({ email: 'creator@example.com' });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3000/dashboard');
  });
});
