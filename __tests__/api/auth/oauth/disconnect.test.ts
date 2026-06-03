import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedSessionUserId = vi.hoisted(() => vi.fn());
const mockGetUserById = vi.hoisted(() => vi.fn());
const mockRevokeStoredGoogleAuthForUser = vi.hoisted(() => vi.fn());
const mockRevertGoogleAuthToPassword = vi.hoisted(() => vi.fn());
const mockBcryptHash = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedSessionUserId: (...args: unknown[]) => mockGetAuthenticatedSessionUserId(...args),
}));

vi.mock('@/lib/repositories/users', () => ({
  getUserById: (...args: unknown[]) => mockGetUserById(...args),
  revokeStoredGoogleAuthForUser: (...args: unknown[]) => mockRevokeStoredGoogleAuthForUser(...args),
  revertGoogleAuthToPassword: (...args: unknown[]) => mockRevertGoogleAuthToPassword(...args),
}));

const googleProfile = {
  userId: 'user-abc',
  email: 'user@example.com',
  hasCompletedOnboarding: false,
  role: 'user' as const,
  authProvider: 'google' as const,
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:00:00.000Z',
};

vi.mock('bcryptjs', () => ({
  default: {
    hash: (...args: unknown[]) => mockBcryptHash(...args),
  },
}));

import { POST } from '@/app/api/auth/oauth/disconnect/route';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/oauth/disconnect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/oauth/disconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedSessionUserId.mockResolvedValue('user-abc');
    mockGetUserById.mockResolvedValue(googleProfile);
    mockRevokeStoredGoogleAuthForUser.mockResolvedValue(undefined);
    mockRevertGoogleAuthToPassword.mockResolvedValue(undefined);
    mockBcryptHash.mockResolvedValue('bcrypt-hash');
  });

  it('returns 401 when not authenticated', async () => {
    mockGetAuthenticatedSessionUserId.mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ password: 'Abcdefg1!', confirmPassword: 'Abcdefg1!' }));

    expect(res.status).toBe(401);
    expect(mockRevokeStoredGoogleAuthForUser).not.toHaveBeenCalled();
  });

  it('returns 404 when the user profile no longer exists', async () => {
    mockGetUserById.mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ password: 'Abcdefg1!', confirmPassword: 'Abcdefg1!' }));

    expect(res.status).toBe(404);
    expect(mockRevokeStoredGoogleAuthForUser).not.toHaveBeenCalled();
  });

  it('returns 400 when account is not Google-linked', async () => {
    mockGetUserById.mockResolvedValueOnce({ ...googleProfile, authProvider: 'password' });

    const res = await POST(makeRequest({ password: 'Abcdefg1!', confirmPassword: 'Abcdefg1!' }));

    expect(res.status).toBe(400);
    expect(mockRevokeStoredGoogleAuthForUser).not.toHaveBeenCalled();
  });

  it('returns 400 when passwords do not match', async () => {
    const res = await POST(makeRequest({ password: 'Abcdefg1!', confirmPassword: 'Otherpass1!' }));

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/do not match/i);
    expect(mockRevokeStoredGoogleAuthForUser).not.toHaveBeenCalled();
  });

  it('returns 400 when password fails policy validation', async () => {
    const res = await POST(makeRequest({ password: 'short', confirmPassword: 'short' }));

    expect(res.status).toBe(400);
    expect(mockRevokeStoredGoogleAuthForUser).not.toHaveBeenCalled();
    expect(mockRevertGoogleAuthToPassword).not.toHaveBeenCalled();
  });

  it('revokes Google tokens and stores a new password on success', async () => {
    const res = await POST(makeRequest({ password: 'Abcdefg1!', confirmPassword: 'Abcdefg1!' }));

    expect(res.status).toBe(200);
    expect(mockRevokeStoredGoogleAuthForUser).toHaveBeenCalledWith('user-abc');
    expect(mockBcryptHash).toHaveBeenCalledWith('Abcdefg1!', 10);
    expect(mockRevertGoogleAuthToPassword).toHaveBeenCalledWith('user-abc', 'bcrypt-hash');
  });
});
