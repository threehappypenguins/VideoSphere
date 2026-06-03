import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedUserId = vi.hoisted(() => vi.fn());
const mockGetUserById = vi.hoisted(() => vi.fn());
const mockGetUserPasswordHashById = vi.hoisted(() => vi.fn());
const mockUpdateUserPasswordHash = vi.hoisted(() => vi.fn());
const mockBcryptCompare = vi.hoisted(() => vi.fn());
const mockBcryptHash = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

vi.mock('@/lib/repositories/users', () => ({
  getUserById: (...args: unknown[]) => mockGetUserById(...args),
  getUserPasswordHashById: (...args: unknown[]) => mockGetUserPasswordHashById(...args),
  updateUserPasswordHash: (...args: unknown[]) => mockUpdateUserPasswordHash(...args),
}));

vi.mock('bcryptjs', () => ({
  default: {
    compare: (...args: unknown[]) => mockBcryptCompare(...args),
    hash: (...args: unknown[]) => mockBcryptHash(...args),
  },
}));

import { POST } from '@/app/api/auth/change-password/route';

const passwordProfile = {
  userId: 'user-abc',
  email: 'user@example.com',
  hasCompletedOnboarding: false,
  role: 'user' as const,
  authProvider: 'password' as const,
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:00:00.000Z',
};

const VALID_NEW_PASSWORD = 'Abcdefg1!';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeChangePasswordBody(
  overrides: Partial<{
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  }> = {}
) {
  return {
    currentPassword: 'Oldpass1!',
    newPassword: VALID_NEW_PASSWORD,
    confirmPassword: VALID_NEW_PASSWORD,
    ...overrides,
  };
}

describe('POST /api/auth/change-password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedUserId.mockResolvedValue('user-abc');
    mockGetUserById.mockResolvedValue(passwordProfile);
    mockGetUserPasswordHashById.mockResolvedValue('stored-password-hash');
    mockUpdateUserPasswordHash.mockResolvedValue(undefined);
    mockBcryptCompare.mockResolvedValue(true);
    mockBcryptHash.mockResolvedValue('new-bcrypt-hash');
  });

  it('returns 401 when not authenticated', async () => {
    mockGetAuthenticatedUserId.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(makeChangePasswordBody()));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Not authenticated.' });
    expect(mockGetUserPasswordHashById).not.toHaveBeenCalled();
  });

  it('returns 403 for Google sign-in accounts', async () => {
    mockGetUserById.mockResolvedValueOnce({
      ...passwordProfile,
      authProvider: 'google',
    });

    const res = await POST(makeRequest(makeChangePasswordBody()));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'Password change is not available for Google sign-in accounts.',
    });
    expect(mockGetUserPasswordHashById).not.toHaveBeenCalled();
  });

  it('returns 401 when the current password is incorrect', async () => {
    mockBcryptCompare.mockResolvedValueOnce(false);

    const res = await POST(makeRequest(makeChangePasswordBody()));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Current password is incorrect.' });
    expect(mockBcryptCompare).toHaveBeenCalledWith('Oldpass1!', 'stored-password-hash');
    expect(mockUpdateUserPasswordHash).not.toHaveBeenCalled();
  });

  it('returns 400 when the new password fails policy validation', async () => {
    const res = await POST(
      makeRequest(
        makeChangePasswordBody({
          newPassword: 'short',
          confirmPassword: 'short',
        })
      )
    );

    expect(res.status).toBe(400);
    const data = (await res.json()) as { error?: string };
    expect(data.error).toBeTruthy();
    expect(mockBcryptCompare).not.toHaveBeenCalled();
    expect(mockUpdateUserPasswordHash).not.toHaveBeenCalled();
  });

  it('returns 400 when new passwords do not match', async () => {
    const res = await POST(
      makeRequest(
        makeChangePasswordBody({
          confirmPassword: 'Otherpass1!',
        })
      )
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'New passwords do not match.' });
    expect(mockBcryptCompare).not.toHaveBeenCalled();
  });

  it('returns 200 and updates the password hash on success', async () => {
    const res = await POST(makeRequest(makeChangePasswordBody()));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockBcryptCompare).toHaveBeenCalledWith('Oldpass1!', 'stored-password-hash');
    expect(mockBcryptHash).toHaveBeenCalledWith(VALID_NEW_PASSWORD, 10);
    expect(mockUpdateUserPasswordHash).toHaveBeenCalledWith('user-abc', 'new-bcrypt-hash');
  });
});
