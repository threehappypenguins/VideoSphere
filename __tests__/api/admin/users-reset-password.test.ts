/**
 * Tests for POST /api/admin/users/[userId]/reset-password
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/admin-auth', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/repositories/users', () => ({
  getUserById: vi.fn(),
  getUserPasswordAuthStateById: vi.fn(),
}));

vi.mock('@/lib/auth/password-reset', () => ({
  ADMIN_RESET_PASSWORD_TOKEN_TTL_MS: 24 * 60 * 60 * 1000,
  buildPasswordResetUrl: vi.fn(),
  issuePasswordResetToken: vi.fn(),
}));

import { POST } from '@/app/api/admin/users/[userId]/reset-password/route';
import { requireAdmin } from '@/lib/api/admin-auth';
import { buildPasswordResetUrl, issuePasswordResetToken } from '@/lib/auth/password-reset';
import { getUserById, getUserPasswordAuthStateById } from '@/lib/repositories/users';

const targetUser = {
  userId: 'user-target',
  email: 'target@example.com',
  role: 'user' as const,
  hasCompletedOnboarding: false,
  $createdAt: '2026-03-01T12:00:00.000Z',
  $updatedAt: '2026-03-01T12:00:00.000Z',
};

function makeRequest(userId: string): NextRequest {
  return new NextRequest(
    new URL(`http://localhost:3000/api/admin/users/${userId}/reset-password`),
    { method: 'POST' }
  );
}

describe('POST /api/admin/users/[userId]/reset-password', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true, userId: 'admin-auth-id' });
    vi.mocked(getUserById).mockResolvedValue(targetUser);
    vi.mocked(getUserPasswordAuthStateById).mockResolvedValue({
      userId: targetUser.userId,
      supportsPasswordReset: true,
    });
    vi.mocked(issuePasswordResetToken).mockResolvedValue({
      token: 'admin-reset-token',
      expiresAt: new Date('2026-06-03T12:00:00.000Z'),
    });
    vi.mocked(buildPasswordResetUrl).mockReturnValue(
      'http://localhost:3000/reset-password?token=admin-reset-token'
    );
  });

  it('returns a reset URL for admin callers', async () => {
    const res = await POST(makeRequest(targetUser.userId), {
      params: Promise.resolve({ userId: targetUser.userId }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      resetUrl: 'http://localhost:3000/reset-password?token=admin-reset-token',
    });
    expect(issuePasswordResetToken).toHaveBeenCalledWith(targetUser.userId, 24 * 60 * 60 * 1000);
  });

  it('returns 404 when the target user does not exist', async () => {
    vi.mocked(getUserById).mockResolvedValueOnce(null);

    const res = await POST(makeRequest('missing-user'), {
      params: Promise.resolve({ userId: 'missing-user' }),
    });

    expect(res.status).toBe(404);
    expect(issuePasswordResetToken).not.toHaveBeenCalled();
  });

  it('returns 409 for Google OAuth-only accounts', async () => {
    vi.mocked(getUserPasswordAuthStateById).mockResolvedValueOnce({
      userId: targetUser.userId,
      supportsPasswordReset: false,
    });

    const res = await POST(makeRequest(targetUser.userId), {
      params: Promise.resolve({ userId: targetUser.userId }),
    });

    expect(res.status).toBe(409);
    expect(issuePasswordResetToken).not.toHaveBeenCalled();
  });

  it('returns admin auth failure responses unchanged', async () => {
    const { NextResponse } = await import('next/server');
    vi.mocked(requireAdmin).mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json(
        { error: 'Forbidden', message: 'Admin access required', statusCode: 403 },
        { status: 403 }
      ),
    });

    const res = await POST(makeRequest(targetUser.userId), {
      params: Promise.resolve({ userId: targetUser.userId }),
    });

    expect(res.status).toBe(403);
    expect(issuePasswordResetToken).not.toHaveBeenCalled();
  });
});
