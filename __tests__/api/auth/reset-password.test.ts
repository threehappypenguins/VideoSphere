/**
 * Tests for POST /api/auth/reset-password
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { mockBcryptHash } = vi.hoisted(() => ({
  mockBcryptHash: vi.fn(),
}));

vi.mock('bcryptjs', () => ({
  default: {
    hash: (...args: unknown[]) => mockBcryptHash(...args),
  },
}));

vi.mock('@/lib/repositories/users', () => ({
  getUserPasswordAuthStateById: vi.fn(),
}));

vi.mock('@/lib/auth/password-reset', () => ({
  findUsablePasswordResetToken: vi.fn(),
  finalizePasswordReset: vi.fn(),
}));

import { POST } from '@/app/api/auth/reset-password/route';
import { finalizePasswordReset, findUsablePasswordResetToken } from '@/lib/auth/password-reset';
import { getUserPasswordAuthStateById } from '@/lib/repositories/users';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/auth/reset-password'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/reset-password', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockBcryptHash.mockResolvedValue('new-password-hash');
    vi.mocked(getUserPasswordAuthStateById).mockResolvedValue({
      userId: 'user-1',
      supportsPasswordReset: true,
    });
    vi.mocked(finalizePasswordReset).mockResolvedValue(true);
  });

  it('updates the password and consumes the token atomically', async () => {
    vi.mocked(findUsablePasswordResetToken).mockResolvedValueOnce({
      id: 'token-doc-1',
      token: 'valid-token',
      userId: 'user-1',
      expiresAt: '2026-06-02T12:15:00.000Z',
      createdAt: '2026-06-02T12:00:00.000Z',
    });

    const res = await POST(
      makeRequest({
        token: 'valid-token',
        newPassword: 'new-password-123',
      })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockBcryptHash).toHaveBeenCalledWith('new-password-123', 10);
    expect(finalizePasswordReset).toHaveBeenCalledWith('valid-token', 'new-password-hash');
  });

  it('rejects invalid or expired tokens', async () => {
    vi.mocked(findUsablePasswordResetToken).mockResolvedValueOnce(null);

    const res = await POST(
      makeRequest({
        token: 'expired-token',
        newPassword: 'new-password-123',
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'This reset link is invalid or has expired.' });
    expect(finalizePasswordReset).not.toHaveBeenCalled();
  });

  it('rejects concurrent token consumption after eligibility checks', async () => {
    vi.mocked(findUsablePasswordResetToken).mockResolvedValueOnce({
      id: 'token-doc-1',
      token: 'valid-token',
      userId: 'user-1',
      expiresAt: '2026-06-02T12:15:00.000Z',
      createdAt: '2026-06-02T12:00:00.000Z',
    });
    vi.mocked(finalizePasswordReset).mockResolvedValueOnce(false);

    const res = await POST(
      makeRequest({
        token: 'valid-token',
        newPassword: 'new-password-123',
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'This reset link is invalid or has expired.' });
  });

  it('rejects passwords shorter than 8 characters', async () => {
    const res = await POST(
      makeRequest({
        token: 'valid-token',
        newPassword: 'short',
      })
    );

    expect(res.status).toBe(400);
    expect(findUsablePasswordResetToken).not.toHaveBeenCalled();
  });

  it('rejects weak common passwords', async () => {
    const res = await POST(
      makeRequest({
        token: 'valid-token',
        newPassword: 'password',
      })
    );

    expect(res.status).toBe(400);
    expect(findUsablePasswordResetToken).not.toHaveBeenCalled();
  });

  it('rejects reset when the token user profile no longer exists', async () => {
    vi.mocked(findUsablePasswordResetToken).mockResolvedValueOnce({
      id: 'token-doc-1',
      token: 'valid-token',
      userId: 'deleted-user',
      expiresAt: '2026-06-02T12:15:00.000Z',
      createdAt: '2026-06-02T12:00:00.000Z',
    });
    vi.mocked(getUserPasswordAuthStateById).mockResolvedValueOnce(null);

    const res = await POST(
      makeRequest({
        token: 'valid-token',
        newPassword: 'Abcdefg1!',
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'This reset link is invalid or has expired.' });
    expect(finalizePasswordReset).not.toHaveBeenCalled();
  });

  it('rejects reset for Google OAuth-only accounts without claiming the token', async () => {
    vi.mocked(findUsablePasswordResetToken).mockResolvedValueOnce({
      id: 'token-doc-1',
      token: 'valid-token',
      userId: 'user-1',
      expiresAt: '2026-06-02T12:15:00.000Z',
      createdAt: '2026-06-02T12:00:00.000Z',
    });
    vi.mocked(getUserPasswordAuthStateById).mockResolvedValueOnce({
      userId: 'user-1',
      supportsPasswordReset: false,
    });

    const res = await POST(
      makeRequest({
        token: 'valid-token',
        newPassword: 'Abcdefg1!',
      })
    );

    expect(res.status).toBe(400);
    expect(finalizePasswordReset).not.toHaveBeenCalled();
  });
});
