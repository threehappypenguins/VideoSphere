import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockGetUserAuthCredentialsByEmail,
  mockBcryptCompare,
  mockJwtSign,
  mockJwtSetSubject,
  mockJwtSetExpirationTime,
} = vi.hoisted(() => ({
  mockGetUserAuthCredentialsByEmail: vi.fn(),
  mockBcryptCompare: vi.fn(),
  mockJwtSign: vi.fn().mockResolvedValue('signed-jwt-token'),
  mockJwtSetSubject: vi.fn(),
  mockJwtSetExpirationTime: vi.fn(),
}));

vi.mock('@/lib/repositories/users', () => ({
  getUserAuthCredentialsByEmail: (...args: unknown[]) => mockGetUserAuthCredentialsByEmail(...args),
}));

vi.mock('bcryptjs', () => ({
  default: {
    compare: (...args: unknown[]) => mockBcryptCompare(...args),
  },
}));

vi.mock('jose', () => ({
  SignJWT: class {
    setProtectedHeader() {
      return this;
    }

    setSubject(subject: string) {
      mockJwtSetSubject(subject);
      return this;
    }

    setIssuedAt() {
      return this;
    }

    setExpirationTime(expiration: string) {
      mockJwtSetExpirationTime(expiration);
      return this;
    }

    sign() {
      return mockJwtSign();
    }
  },
}));

import { POST } from '@/app/api/auth/login/route';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const DUMMY_PASSWORD_HASH = '$2b$10$C6UzMDM.H6dfI/f/IKcEeO5bVJY4UqVaki3P6KyHRxY6z3n9JVpaz';

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'test-jwt-secret-for-vitest-only';
    delete process.env.JWT_SESSION_COOKIE_NAME;
    delete process.env.JWT_SESSION_MAX_AGE_SECONDS;
  });

  it('returns 200, signs JWT, and sets session cookie for valid credentials', async () => {
    mockGetUserAuthCredentialsByEmail.mockResolvedValueOnce({
      userId: 'user-1',
      passwordHash: 'stored-password-hash',
      role: 'admin',
      totpEnabled: false,
    });
    mockBcryptCompare.mockResolvedValueOnce(true);

    const res = await POST(
      makeRequest({
        email: '  CREATOR@Example.com  ',
        password: 'password123',
      })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(mockGetUserAuthCredentialsByEmail).toHaveBeenCalledWith('creator@example.com');
    expect(mockBcryptCompare).toHaveBeenCalledWith('password123', 'stored-password-hash');
    expect(mockJwtSetSubject).toHaveBeenCalledWith('user-1');
    expect(mockJwtSetExpirationTime).toHaveBeenCalledWith('604800s');
    expect(mockJwtSign).toHaveBeenCalledTimes(1);

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('videosphere_session=signed-jwt-token');
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Path=\//i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
  });

  it('returns 401 for invalid password', async () => {
    mockGetUserAuthCredentialsByEmail.mockResolvedValueOnce({
      userId: 'user-1',
      passwordHash: 'stored-password-hash',
      role: 'user',
      totpEnabled: false,
    });
    mockBcryptCompare.mockResolvedValueOnce(false);

    const res = await POST(
      makeRequest({
        email: 'creator@example.com',
        password: 'wrong-password',
      })
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Invalid email or password.' });
    expect(mockBcryptCompare).toHaveBeenCalledWith('wrong-password', 'stored-password-hash');
    expect(mockJwtSign).not.toHaveBeenCalled();
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('returns 401 for unknown email and uses dummy hash timing path', async () => {
    mockGetUserAuthCredentialsByEmail.mockResolvedValueOnce(null);
    mockBcryptCompare.mockResolvedValueOnce(false);

    const res = await POST(
      makeRequest({
        email: 'missing@example.com',
        password: 'password123',
      })
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Invalid email or password.' });
    expect(mockGetUserAuthCredentialsByEmail).toHaveBeenCalledWith('missing@example.com');
    expect(mockBcryptCompare).toHaveBeenCalledWith('password123', DUMMY_PASSWORD_HASH);
    expect(mockJwtSign).not.toHaveBeenCalled();
  });

  it('returns 500 when JWT_SECRET is missing', async () => {
    delete process.env.JWT_SECRET;

    const res = await POST(
      makeRequest({
        email: 'creator@example.com',
        password: 'password123',
      })
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Server misconfiguration.' });
    expect(mockGetUserAuthCredentialsByEmail).not.toHaveBeenCalled();
    expect(mockBcryptCompare).not.toHaveBeenCalled();
    expect(mockJwtSign).not.toHaveBeenCalled();
  });

  it('returns 401 for OAuth-only accounts without passwordHash', async () => {
    // Repository contract: users without passwordHash resolve to null credentials.
    mockGetUserAuthCredentialsByEmail.mockResolvedValueOnce(null);
    mockBcryptCompare.mockResolvedValueOnce(false);

    const res = await POST(
      makeRequest({
        email: 'oauth-user@example.com',
        password: 'password123',
      })
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Invalid email or password.' });
    expect(mockGetUserAuthCredentialsByEmail).toHaveBeenCalledWith('oauth-user@example.com');
    expect(mockBcryptCompare).toHaveBeenCalledWith('password123', DUMMY_PASSWORD_HASH);
    expect(mockJwtSign).not.toHaveBeenCalled();
  });
});
