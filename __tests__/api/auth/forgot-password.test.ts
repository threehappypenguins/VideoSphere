/**
 * Tests for POST /api/auth/forgot-password
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/repositories/users', () => ({
  getUserByEmail: vi.fn(),
  getUserPasswordAuthStateByEmail: vi.fn(),
}));

vi.mock('@/lib/auth/password-reset', () => ({
  FORGOT_PASSWORD_TOKEN_TTL_MS: 15 * 60 * 1000,
  buildPasswordResetUrl: vi.fn(),
  isForgotPasswordRateLimited: vi.fn(),
  issuePasswordResetToken: vi.fn(),
  logForgotPasswordResetTokenToStdout: vi.fn(),
}));

import { POST } from '@/app/api/auth/forgot-password/route';
import {
  buildPasswordResetUrl,
  isForgotPasswordRateLimited,
  issuePasswordResetToken,
  logForgotPasswordResetTokenToStdout,
} from '@/lib/auth/password-reset';
import { getUserByEmail, getUserPasswordAuthStateByEmail } from '@/lib/repositories/users';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/auth/forgot-password'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/forgot-password', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getUserPasswordAuthStateByEmail).mockResolvedValue({
      userId: 'user-1',
      supportsPasswordReset: true,
    });
    vi.mocked(issuePasswordResetToken).mockResolvedValue({
      token: 'reset-token-value',
      expiresAt: new Date('2026-06-02T12:15:00.000Z'),
    });
    vi.mocked(buildPasswordResetUrl).mockReturnValue(
      'http://localhost:3000/reset-password?token=reset-token-value'
    );
    vi.mocked(isForgotPasswordRateLimited).mockResolvedValue(false);
  });

  it('always returns ok:true for unknown emails without issuing a token', async () => {
    vi.mocked(getUserByEmail).mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ email: 'missing@example.com' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(issuePasswordResetToken).not.toHaveBeenCalled();
    expect(logForgotPasswordResetTokenToStdout).not.toHaveBeenCalled();
  });

  it('issues a token and logs it for known emails', async () => {
    vi.mocked(getUserByEmail).mockResolvedValueOnce({
      userId: 'user-1',
      email: 'admin@example.com',
      role: 'admin',
      hasCompletedOnboarding: true,
      $createdAt: '2026-01-01T00:00:00.000Z',
      $updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const res = await POST(makeRequest({ email: '  ADMIN@Example.com  ' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(getUserByEmail).toHaveBeenCalledWith('admin@example.com');
    expect(issuePasswordResetToken).toHaveBeenCalledWith('user-1', 15 * 60 * 1000);
    expect(logForgotPasswordResetTokenToStdout).toHaveBeenCalledWith(
      'admin@example.com',
      'http://localhost:3000/reset-password?token=reset-token-value',
      new Date('2026-06-02T12:15:00.000Z')
    );
  });

  it('returns ok:true without logging when rate limited', async () => {
    vi.mocked(getUserByEmail).mockResolvedValueOnce({
      userId: 'user-1',
      email: 'admin@example.com',
      role: 'admin',
      hasCompletedOnboarding: true,
      $createdAt: '2026-01-01T00:00:00.000Z',
      $updatedAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(isForgotPasswordRateLimited).mockResolvedValueOnce(true);

    const res = await POST(makeRequest({ email: 'admin@example.com' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(issuePasswordResetToken).not.toHaveBeenCalled();
    expect(logForgotPasswordResetTokenToStdout).not.toHaveBeenCalled();
  });

  it('does not issue a token for Google OAuth-only accounts', async () => {
    vi.mocked(getUserByEmail).mockResolvedValueOnce({
      userId: 'user-1',
      email: 'oauth@example.com',
      role: 'user',
      hasCompletedOnboarding: true,
      $createdAt: '2026-01-01T00:00:00.000Z',
      $updatedAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(getUserPasswordAuthStateByEmail).mockResolvedValueOnce({
      userId: 'user-1',
      supportsPasswordReset: false,
    });

    const res = await POST(makeRequest({ email: 'oauth@example.com' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(issuePasswordResetToken).not.toHaveBeenCalled();
    expect(logForgotPasswordResetTokenToStdout).not.toHaveBeenCalled();
  });

  it('validates email format', async () => {
    const res = await POST(makeRequest({ email: 'not-an-email' }));

    expect(res.status).toBe(400);
    expect(issuePasswordResetToken).not.toHaveBeenCalled();
  });
});
