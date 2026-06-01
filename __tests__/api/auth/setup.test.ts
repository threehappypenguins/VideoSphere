import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockCreateUser = vi.hoisted(() => vi.fn());
const mockJwtSign = vi.hoisted(() => vi.fn().mockResolvedValue('jwt-token'));
const mockHasAnyUsers = vi.hoisted(() => vi.fn());
const mockIsSetupTokenValid = vi.hoisted(() => vi.fn());
const mockConsumeSetupToken = vi.hoisted(() => vi.fn());
const mockReleaseSetupToken = vi.hoisted(() => vi.fn());

vi.mock('@/lib/repositories/users', () => ({
  createUser: (...args: unknown[]) => mockCreateUser(...args),
}));

vi.mock('@/lib/repositories/invites', () => ({
  hasAnyUsers: (...args: unknown[]) => mockHasAnyUsers(...args),
  isSetupTokenValid: (...args: unknown[]) => mockIsSetupTokenValid(...args),
  consumeSetupToken: (...args: unknown[]) => mockConsumeSetupToken(...args),
  releaseSetupToken: (...args: unknown[]) => mockReleaseSetupToken(...args),
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

import { POST } from '@/app/api/auth/setup/route';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/auth/setup'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validPayload = {
  name: '  Admin User  ',
  email: 'ADMIN@Example.com',
  password: 'password123',
  token: 'setup-token-1',
};

describe('POST /api/auth/setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'test-jwt-secret-for-vitest-only';
    mockHasAnyUsers.mockResolvedValue(false);
    mockIsSetupTokenValid.mockResolvedValue(true);
    mockConsumeSetupToken.mockResolvedValue(true);
    mockReleaseSetupToken.mockResolvedValue(true);
    mockCreateUser.mockResolvedValue({ userId: 'admin-1', email: 'admin@example.com' });
  });

  it('creates the first admin, consumes the setup token, and issues a session cookie', async () => {
    const res = await POST(makeRequest(validPayload));

    expect(res.status).toBe(201);
    expect(mockHasAnyUsers).toHaveBeenCalled();
    expect(mockIsSetupTokenValid).toHaveBeenCalledWith('setup-token-1');
    expect(mockConsumeSetupToken).toHaveBeenCalledWith('setup-token-1', expect.any(String));
    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: expect.any(String),
        email: 'admin@example.com',
        name: 'Admin User',
        passwordHash: expect.any(String),
        role: 'admin',
      })
    );

    const body = await res.json();
    expect(body).toEqual({
      message: 'Setup completed successfully.',
      userId: expect.any(String),
    });

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('videosphere_session=');
    expect(setCookie).toContain('jwt-token');
  });

  it('rejects missing required fields with a consistent validation message', async () => {
    const res = await POST(
      makeRequest({
        email: 'admin@example.com',
        password: 'password123',
        token: 'setup-token-1',
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Name, email, password, and token are required and must be strings.',
    });
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('rejects blank trimmed names', async () => {
    const res = await POST(
      makeRequest({
        ...validPayload,
        name: '   ',
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Name is required.' });
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('returns 403 when setup is already completed', async () => {
    mockHasAnyUsers.mockResolvedValueOnce(true);

    const res = await POST(makeRequest(validPayload));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Setup is already completed.' });
    expect(mockIsSetupTokenValid).not.toHaveBeenCalled();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('returns 404 when the setup token is invalid', async () => {
    mockIsSetupTokenValid.mockResolvedValueOnce(false);

    const res = await POST(makeRequest(validPayload));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Setup token is invalid.' });
    expect(mockConsumeSetupToken).not.toHaveBeenCalled();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('returns 409 when the setup token can no longer be consumed', async () => {
    mockConsumeSetupToken.mockResolvedValueOnce(false);

    const res = await POST(makeRequest(validPayload));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Setup token is no longer valid.' });
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('returns 409 for duplicate email and releases the setup token', async () => {
    mockCreateUser.mockRejectedValueOnce(
      Object.assign(new Error('E11000 duplicate key error'), { code: 11000 })
    );

    const res = await POST(makeRequest(validPayload));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Email already registered. Please sign in instead.',
    });
    expect(mockReleaseSetupToken).toHaveBeenCalledWith('setup-token-1', expect.any(String));
  });

  it('releases the setup token when user creation fails unexpectedly', async () => {
    mockCreateUser.mockRejectedValueOnce(new Error('db down'));

    const res = await POST(makeRequest(validPayload));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'An unexpected error occurred. Please try again later.',
    });
    expect(mockReleaseSetupToken).toHaveBeenCalledWith('setup-token-1', expect.any(String));
  });
});
