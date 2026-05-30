import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCookies, mockJwtVerify, mockGetUserById } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockJwtVerify: vi.fn(),
  mockGetUserById: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: (...args: unknown[]) => mockCookies(...args),
}));

vi.mock('jose', () => ({
  jwtVerify: (...args: unknown[]) => mockJwtVerify(...args),
}));

vi.mock('@/lib/repositories/users', () => ({
  getUserById: (...args: unknown[]) => mockGetUserById(...args),
}));

import { getSessionUserFromCookies } from '@/lib/auth/get-current-user-id-from-cookies';

function cookieStoreWith(token: string | null) {
  return {
    get: vi.fn((name: string) => {
      if (name === 'videosphere_session' && token) {
        return { value: token };
      }
      return undefined;
    }),
  };
}

describe('getSessionUserFromCookies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret';
    process.env.JWT_SESSION_COOKIE_NAME = 'videosphere_session';
    process.env.NODE_ENV = 'test';
  });

  it('returns session user when JWT is valid and profile exists', async () => {
    mockCookies.mockResolvedValueOnce(cookieStoreWith('valid-jwt'));
    mockJwtVerify.mockResolvedValueOnce({ payload: { sub: 'user-1' } });
    mockGetUserById.mockResolvedValueOnce({
      userId: 'user-1',
      name: 'User One',
      email: 'u1@test.dev',
    });

    const sessionUser = await getSessionUserFromCookies();

    expect(sessionUser).toEqual({
      $id: 'user-1',
      name: 'User One',
      email: 'u1@test.dev',
    });
  });

  it('returns null when JWT is valid but profile lookup returns null', async () => {
    mockCookies.mockResolvedValueOnce(cookieStoreWith('valid-jwt'));
    mockJwtVerify.mockResolvedValueOnce({ payload: { sub: 'deleted-user' } });
    mockGetUserById.mockResolvedValueOnce(null);

    const sessionUser = await getSessionUserFromCookies();

    expect(sessionUser).toBeNull();
  });
});
