/**
 * Tests for PATCH and DELETE /api/admin/users/[userId]
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/repositories/users', () => ({
  getUserById: vi.fn(),
  updateUser: vi.fn(),
  revokeStoredGoogleAuthForUser: vi.fn(),
  deleteUserById: vi.fn(),
  countUsersWithRole: vi.fn(),
}));

import { PATCH, DELETE } from '@/app/api/admin/users/[userId]/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import {
  countUsersWithRole,
  deleteUserById,
  getUserById,
  revokeStoredGoogleAuthForUser,
  updateUser,
} from '@/lib/repositories/users';
import type { User } from '@/types';

const adminProfile: User = {
  userId: 'admin-auth-id',
  email: 'admin@example.com',
  role: 'admin',
  hasCompletedOnboarding: false,
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-02T00:00:00.000Z',
};

const targetUser: User = {
  userId: 'user-target',
  email: 'target@example.com',
  name: 'Target User',
  role: 'user',
  hasCompletedOnboarding: false,
  $createdAt: '2026-03-01T12:00:00.000Z',
  $updatedAt: '2026-03-01T12:00:00.000Z',
};

function makePatchRequest(userId: string, body: unknown): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000/api/admin/users/${userId}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest(userId: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000/api/admin/users/${userId}`), {
    method: 'DELETE',
  });
}

describe('PATCH /api/admin/users/[userId]', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAuthenticatedUserId).mockResolvedValue(adminProfile.userId);
    vi.mocked(getUserById).mockImplementation(async (id) => {
      if (id === adminProfile.userId) return adminProfile;
      if (id === targetUser.userId) return targetUser;
      return null;
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('updates user role for admin callers', async () => {
    const updatedUser = { ...targetUser, role: 'admin' as const };
    vi.mocked(updateUser).mockResolvedValueOnce(updatedUser);

    const res = await PATCH(makePatchRequest(targetUser.userId, { role: 'admin' }), {
      params: Promise.resolve({ userId: targetUser.userId }),
    });

    expect(res.status).toBe(200);
    expect(updateUser).toHaveBeenCalledWith(targetUser.userId, { role: 'admin' });
    const body = await res.json();
    expect(body.data.user.role).toBe('admin');
  });

  it('returns 404 when updateUser throws a not-found error', async () => {
    const notFound = Object.assign(new Error('User profile not found'), { code: 404 });
    vi.mocked(updateUser).mockRejectedValueOnce(notFound);

    const res = await PATCH(makePatchRequest(targetUser.userId, { role: 'admin' }), {
      params: Promise.resolve({ userId: targetUser.userId }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'User not found.' });
  });

  it('rejects demoting the last admin', async () => {
    const loneAdmin = { ...adminProfile, userId: 'solo-admin' };
    vi.mocked(getUserById).mockResolvedValueOnce(loneAdmin);
    vi.mocked(countUsersWithRole).mockResolvedValueOnce(1);

    const res = await PATCH(makePatchRequest('solo-admin', { role: 'user' }), {
      params: Promise.resolve({ userId: 'solo-admin' }),
    });

    expect(res.status).toBe(409);
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/users/[userId]', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAuthenticatedUserId).mockResolvedValue(adminProfile.userId);
    vi.mocked(getUserById).mockImplementation(async (id) => {
      if (id === adminProfile.userId) return adminProfile;
      if (id === targetUser.userId) return targetUser;
      return null;
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('prevents deleting your own account', async () => {
    const res = await DELETE(makeDeleteRequest(adminProfile.userId), {
      params: Promise.resolve({ userId: adminProfile.userId }),
    });

    expect(res.status).toBe(409);
    expect(deleteUserById).not.toHaveBeenCalled();
  });

  it('deletes another user', async () => {
    vi.mocked(revokeStoredGoogleAuthForUser).mockResolvedValueOnce(undefined);
    vi.mocked(deleteUserById).mockResolvedValueOnce(true);

    const res = await DELETE(makeDeleteRequest(targetUser.userId), {
      params: Promise.resolve({ userId: targetUser.userId }),
    });

    expect(res.status).toBe(204);
    expect(revokeStoredGoogleAuthForUser).toHaveBeenCalledWith(targetUser.userId);
    expect(deleteUserById).toHaveBeenCalledWith(targetUser.userId);
  });

  it('prevents deleting the last admin', async () => {
    const loneAdmin = { ...targetUser, userId: 'solo-admin', role: 'admin' as const };
    vi.mocked(getUserById).mockImplementation(async (id) => {
      if (id === adminProfile.userId) return adminProfile;
      if (id === 'solo-admin') return loneAdmin;
      return null;
    });
    vi.mocked(countUsersWithRole).mockResolvedValueOnce(1);

    const res = await DELETE(makeDeleteRequest('solo-admin'), {
      params: Promise.resolve({ userId: 'solo-admin' }),
    });

    expect(res.status).toBe(409);
    expect(deleteUserById).not.toHaveBeenCalled();
  });
});
