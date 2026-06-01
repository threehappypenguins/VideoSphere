import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockCreateUser = vi.hoisted(() => vi.fn());
const mockJwtSign = vi.hoisted(() => vi.fn().mockResolvedValue('jwt-token'));
const mockIsInviteTokenValid = vi.hoisted(() => vi.fn());
const mockConsumeInviteToken = vi.hoisted(() => vi.fn());
const mockReleaseInviteToken = vi.hoisted(() => vi.fn());

vi.mock('@/lib/repositories/users', () => ({
  createUser: (...args: unknown[]) => mockCreateUser(...args),
}));

vi.mock('@/lib/repositories/invites', () => ({
  isInviteTokenValid: (...args: unknown[]) => mockIsInviteTokenValid(...args),
  consumeInviteToken: (...args: unknown[]) => mockConsumeInviteToken(...args),
  releaseInviteToken: (...args: unknown[]) => mockReleaseInviteToken(...args),
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
    mockIsInviteTokenValid.mockResolvedValue(true);
    mockConsumeInviteToken.mockResolvedValue({
      grantedRole: 'user',
      releaseSnapshot: {
        token: 'invite-token-1',
        grantedRole: 'user',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    mockReleaseInviteToken.mockResolvedValue(true);
  });

  it('persists the trimmed name when registering with a valid invite token', async () => {
    const res = await POST(
      makeRequest({
        name: '  Ada Lovelace  ',
        email: 'CREATOR@Example.com',
        password: 'password123',
        inviteToken: 'invite-token-1',
      })
    );

    expect(res.status).toBe(201);
    expect(mockIsInviteTokenValid).toHaveBeenCalledWith('invite-token-1');
    expect(mockConsumeInviteToken).toHaveBeenCalledWith('invite-token-1', expect.any(String));
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

  it('rejects missing name with the required-fields message', async () => {
    const res = await POST(
      makeRequest({
        email: 'creator@example.com',
        password: 'password123',
        inviteToken: 'invite-token-1',
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Name, email, password, and inviteToken are required and must be strings.',
    });
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('rejects blank trimmed names', async () => {
    const res = await POST(
      makeRequest({
        name: '   ',
        email: 'creator@example.com',
        password: 'password123',
        inviteToken: 'invite-token-1',
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Name is required.' });
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('requires a valid invite token', async () => {
    mockIsInviteTokenValid.mockResolvedValue(false);

    const res = await POST(
      makeRequest({
        name: 'Ada Lovelace',
        email: 'creator@example.com',
        password: 'password123',
        inviteToken: 'bad-token',
      })
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Invite token is invalid.' });
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('releases the invite token when user creation fails', async () => {
    mockCreateUser.mockRejectedValue(new Error('db down'));

    const res = await POST(
      makeRequest({
        name: 'Ada Lovelace',
        email: 'creator@example.com',
        password: 'password123',
        inviteToken: 'invite-token-1',
      })
    );

    expect(res.status).toBe(500);
    expect(mockReleaseInviteToken).toHaveBeenCalledWith({
      token: 'invite-token-1',
      grantedRole: 'user',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  });
});
