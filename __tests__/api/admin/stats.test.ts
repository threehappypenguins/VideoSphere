/**
 * Tests for GET /api/admin/stats
 *
 * Covers RBAC (401/403) and success ApiResponse shape — security-critical admin surface.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/repositories/users', () => ({
  getUserById: vi.fn(),
  getUserCounts: vi.fn(),
}));

vi.mock('@/lib/repositories/upload-usage', () => ({
  getCurrentUsageMonth: vi.fn(),
  getTotalUploadsForMonth: vi.fn(),
}));

vi.mock('@/lib/repositories/drafts', () => ({
  countActiveDrafts: vi.fn(),
}));

import { GET } from '@/app/api/admin/stats/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { countActiveDrafts } from '@/lib/repositories/drafts';
import { getCurrentUsageMonth, getTotalUploadsForMonth } from '@/lib/repositories/upload-usage';
import { getUserById, getUserCounts } from '@/lib/repositories/users';
import type { User } from '@/types';

function makeGetRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/admin/stats'), { method: 'GET' });
}

const adminProfile: User = {
  userId: 'admin-auth-id',
  email: 'admin@example.com',
  isSupporter: false,
  role: 'admin',
  hasCompletedOnboarding: false,
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-02T00:00:00.000Z',
};

describe('GET /api/admin/stats', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

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
    expect(getUserCounts).not.toHaveBeenCalled();
    expect(getCurrentUsageMonth).not.toHaveBeenCalled();
    expect(getTotalUploadsForMonth).not.toHaveBeenCalled();
    expect(countActiveDrafts).not.toHaveBeenCalled();
  });

  it('returns 403 ApiError when authenticated but not admin', async () => {
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

    expect(getUserCounts).not.toHaveBeenCalled();
    expect(getTotalUploadsForMonth).not.toHaveBeenCalled();
    expect(countActiveDrafts).not.toHaveBeenCalled();
  });

  it('returns 200 ApiResponse with expected stats fields for admin', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(adminProfile.userId);
    vi.mocked(getUserById).mockResolvedValueOnce(adminProfile);

    vi.mocked(getCurrentUsageMonth).mockReturnValueOnce('2026-03');
    vi.mocked(getUserCounts).mockResolvedValueOnce({
      totalUsers: 120,
      totalSupporters: 15,
    });
    vi.mocked(getTotalUploadsForMonth).mockResolvedValueOnce(240);
    vi.mocked(countActiveDrafts).mockResolvedValueOnce(8);

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);

    expect(getCurrentUsageMonth).toHaveBeenCalledOnce();
    expect(getTotalUploadsForMonth).toHaveBeenCalledWith('2026-03');
    expect(getUserCounts).toHaveBeenCalledOnce();
    expect(countActiveDrafts).toHaveBeenCalledOnce();

    const body = await res.json();
    expect(body).toEqual({
      data: {
        totalUsers: 120,
        totalSupporters: 15,
        uploadsThisMonth: 240,
        activeDrafts: 8,
      },
    });
  });

  it('returns 500 ApiError when getUserById throws during admin check', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce('admin-1');
    vi.mocked(getUserById).mockRejectedValueOnce(new Error('Appwrite down'));

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      error: 'Internal Server Error',
      message: 'Failed to verify admin access',
      statusCode: 500,
    });
    expect(getUserCounts).not.toHaveBeenCalled();
  });

  it('returns 500 ApiError when stats aggregation throws', async () => {
    vi.mocked(getAuthenticatedUserId).mockResolvedValueOnce(adminProfile.userId);
    vi.mocked(getUserById).mockResolvedValueOnce(adminProfile);
    vi.mocked(getCurrentUsageMonth).mockReturnValueOnce('2026-03');
    vi.mocked(getUserCounts).mockRejectedValueOnce(new Error('list failed'));

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      error: 'Internal Server Error',
      message: 'Failed to load admin stats',
      statusCode: 500,
    });
  });
});
