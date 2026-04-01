/**
 * Tests for GET /api/admin/users
 *
 * Covers RBAC (401/403/500 on admin gate), response shape (ApiResponse / ApiError),
 * and pagination query forwarding.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/repositories/users', () => ({
  getUserById: vi.fn(),
  listUsers: vi.fn(),
}));

import { GET } from '@/app/api/admin/users/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getUserById, listUsers } from '@/lib/repositories/users';
import type { User } from '@/types';

function makeGetRequest(search = ''): NextRequest {
  const url = new URL(`http://localhost:3000/api/admin/users${search}`);
  return new NextRequest(url, { method: 'GET' });
}

const adminProfile: User = {
  userId: 'admin-auth-id',
  email: 'admin@example.com',
  isSupporter: true,
  hasCompletedOnboarding: true,
  role: 'admin',
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-02T00:00:00.000Z',
};

const listedUser: User = {
  userId: 'user-a',
  email: 'alice@example.com',
  isSupporter: false,
  hasCompletedOnboarding: true,
  role: 'user',
  $createdAt: '2026-03-01T12:00:00.000Z',
  $updatedAt: '2026-03-01T12:00:00.000Z',
};

describe('GET /api/admin/users', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('RBAC', () => {
    it('returns 401 ApiError when not authenticated', async () => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(null);

      const res = await GET(makeGetRequest());
      expect(res.status).toBe(401);

      const body = await res.json();
      expect(body).toEqual({
        error: 'Unauthorized',
        message: 'Not authenticated',
        statusCode: 401,
      });
      expect(getUserById).not.toHaveBeenCalled();
      expect(listUsers).not.toHaveBeenCalled();
    });

    it('returns 403 ApiError when authenticated but role is user', async () => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce('user-1');
      vi.mocked(getUserById).mockResolvedValueOnce({
        ...adminProfile,
        userId: 'user-1',
        role: 'user',
      });

      const res = await GET(makeGetRequest());
      expect(res.status).toBe(403);

      const body = await res.json();
      expect(body).toEqual({
        error: 'Forbidden',
        message: 'Admin access required',
        statusCode: 403,
      });
      expect(listUsers).not.toHaveBeenCalled();
    });

    it('returns 403 ApiError when user profile is missing', async () => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce('orphan-auth');
      vi.mocked(getUserById).mockResolvedValueOnce(null);

      const res = await GET(makeGetRequest());
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.statusCode).toBe(403);
      expect(listUsers).not.toHaveBeenCalled();
    });

    it('returns 500 ApiError when getUserById throws', async () => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce('admin-1');
      vi.mocked(getUserById).mockRejectedValueOnce(new Error('Appwrite unavailable'));

      const res = await GET(makeGetRequest());
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toEqual({
        error: 'Internal Server Error',
        message: 'Failed to verify admin access',
        statusCode: 500,
      });
      expect(listUsers).not.toHaveBeenCalled();
    });
  });

  describe('success response shape and pagination', () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUserId).mockResolvedValue(adminProfile.userId);
      vi.mocked(getUserById).mockResolvedValue(adminProfile);
    });

    it('returns 200 ApiResponse with users and pagination', async () => {
      vi.mocked(listUsers).mockResolvedValueOnce({
        users: [listedUser],
        total: 128,
      });

      const res = await GET(makeGetRequest('?limit=50&offset=10'));
      expect(res.status).toBe(200);

      expect(listUsers).toHaveBeenCalledWith({ limit: 50, offset: 10 });

      const body = await res.json();
      expect(body.data).toBeDefined();
      expect(body.data.users).toHaveLength(1);
      expect(body.data.users[0]).toEqual({
        userId: listedUser.userId,
        email: listedUser.email,
        role: listedUser.role,
        isSupporter: listedUser.isSupporter,
        createdAt: listedUser.$createdAt,
      });
      expect(body.data.pagination).toEqual({
        limit: 50,
        offset: 10,
        total: 128,
      });
    });

    it('defaults limit to 25 and offset to 0 when query params omitted', async () => {
      vi.mocked(listUsers).mockResolvedValueOnce({ users: [], total: 0 });

      const res = await GET(makeGetRequest());
      expect(res.status).toBe(200);
      expect(listUsers).toHaveBeenCalledWith({ limit: 25, offset: 0 });

      const body = await res.json();
      expect(body.data.pagination).toEqual({ limit: 25, offset: 0, total: 0 });
    });

    it('caps limit at 100', async () => {
      vi.mocked(listUsers).mockResolvedValueOnce({ users: [], total: 0 });

      await GET(makeGetRequest('?limit=500'));
      expect(listUsers).toHaveBeenCalledWith({ limit: 100, offset: 0 });
    });

    it('returns 500 ApiError when listUsers throws', async () => {
      vi.mocked(listUsers).mockRejectedValueOnce(new Error('database error'));

      const res = await GET(makeGetRequest());
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toEqual({
        error: 'Internal Server Error',
        message: 'Failed to load users',
        statusCode: 500,
      });
    });
  });
});
