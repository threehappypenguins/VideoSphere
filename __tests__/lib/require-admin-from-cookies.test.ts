import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRedirect = vi.hoisted(() => vi.fn());
const mockCookies = vi.hoisted(() => vi.fn());
const mockJwtVerify = vi.hoisted(() => vi.fn());
const mockGetUserById = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url),
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

import { requireAdminUserIdFromCookies } from '@/lib/auth/get-current-user-id-from-cookies';

function cookieStoreWith(token: string | null) {
  return {
    get: vi.fn((name: string) => {
      if (name === 'videosphere_session' && token) {
        return { value: token };
      }
      return undefined;
    }),
    getAll: vi.fn(() => []),
  };
}

describe('requireAdminUserIdFromCookies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedirect.mockImplementation((url: string) => {
      throw Object.assign(new Error('NEXT_REDIRECT'), { digest: url });
    });
    vi.stubEnv('JWT_SECRET', 'test-secret');
    vi.stubEnv('JWT_SESSION_COOKIE_NAME', 'videosphere_session');
    vi.stubEnv('NODE_ENV', 'test');
  });

  it('returns the user id for an authenticated admin', async () => {
    mockCookies.mockResolvedValueOnce(cookieStoreWith('valid-jwt'));
    mockJwtVerify.mockResolvedValueOnce({ payload: { sub: 'admin-1' } });
    mockGetUserById.mockResolvedValue({
      userId: 'admin-1',
      role: 'admin',
      email: 'admin@test.dev',
    });

    await expect(
      requireAdminUserIdFromCookies({ loginRedirectPath: '/dashboard/users' })
    ).resolves.toBe('admin-1');
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('redirects to login when the session is missing', async () => {
    mockCookies.mockResolvedValueOnce(cookieStoreWith(null));

    await expect(
      requireAdminUserIdFromCookies({ loginRedirectPath: '/dashboard/users' })
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledWith('/login?redirect=%2Fdashboard%2Fusers');
  });

  it('redirects non-admins to the dashboard', async () => {
    mockCookies.mockResolvedValueOnce(cookieStoreWith('valid-jwt'));
    mockJwtVerify.mockResolvedValueOnce({ payload: { sub: 'user-1' } });
    mockGetUserById.mockResolvedValue({
      userId: 'user-1',
      role: 'user',
      email: 'user@test.dev',
    });

    await expect(requireAdminUserIdFromCookies()).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledWith('/dashboard');
  });
});
