import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockCreateUser = vi.hoisted(() => vi.fn());
const mockJwtSign = vi.hoisted(() => vi.fn().mockResolvedValue('jwt-token'));

vi.mock('@/lib/repositories/users', () => ({
  createUser: (...args: unknown[]) => mockCreateUser(...args),
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

import { POST } from '@/app/api/auth/register/route';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/auth/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'test-jwt-secret-for-vitest-only';
    mockCreateUser.mockResolvedValue({ userId: 'user-1', email: 'creator@example.com' });
  });

  it('persists the trimmed name when registering a new user', async () => {
    const res = await POST(
      makeRequest({
        name: '  Ada Lovelace  ',
        email: 'CREATOR@Example.com',
        password: 'password123',
      })
    );

    expect(res.status).toBe(201);
    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: expect.any(String),
        email: 'creator@example.com',
        name: 'Ada Lovelace',
        passwordHash: expect.any(String),
        role: 'user',
      })
    );
  });

  it('rejects blank trimmed names', async () => {
    const res = await POST(
      makeRequest({
        name: '   ',
        email: 'creator@example.com',
        password: 'password123',
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Name is required.' });
    expect(mockCreateUser).not.toHaveBeenCalled();
  });
});
