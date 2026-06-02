/**
 * Tests for POST /api/auth/forgot-password
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/repositories/users', () => ({
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
import { getUserPasswordAuthStateByEmail } from '@/lib/repositories/users';

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

  describe('well-formed requests (anti-enumeration)', () => {
    it('returns ok:true for unknown emails without issuing a token', async () => {
      vi.mocked(getUserPasswordAuthStateByEmail).mockResolvedValueOnce(null);

      const res = await POST(makeRequest({ email: 'missing@example.com' }));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(issuePasswordResetToken).not.toHaveBeenCalled();
      expect(logForgotPasswordResetTokenToStdout).not.toHaveBeenCalled();
    });

    it('issues a token and logs it for known emails', async () => {
      const res = await POST(makeRequest({ email: '  ADMIN@Example.com  ' }));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(getUserPasswordAuthStateByEmail).toHaveBeenCalledWith('admin@example.com');
      expect(issuePasswordResetToken).toHaveBeenCalledWith(
        'user-1',
        15 * 60 * 1000,
        'forgot-password'
      );
      expect(logForgotPasswordResetTokenToStdout).toHaveBeenCalledWith(
        'admin@example.com',
        'http://localhost:3000/reset-password?token=reset-token-value',
        new Date('2026-06-02T12:15:00.000Z')
      );
    });

    it('returns ok:true without logging when rate limited', async () => {
      vi.mocked(isForgotPasswordRateLimited).mockResolvedValueOnce(true);

      const res = await POST(makeRequest({ email: 'admin@example.com' }));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(issuePasswordResetToken).not.toHaveBeenCalled();
      expect(logForgotPasswordResetTokenToStdout).not.toHaveBeenCalled();
    });

    it('does not issue a token for Google OAuth-only accounts', async () => {
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
  });

  describe('malformed requests', () => {
    it('returns 400 for invalid email format', async () => {
      const res = await POST(makeRequest({ email: 'not-an-email' }));

      expect(res.status).toBe(400);
      expect(getUserPasswordAuthStateByEmail).not.toHaveBeenCalled();
      expect(issuePasswordResetToken).not.toHaveBeenCalled();
    });

    it('returns 400 when email is missing', async () => {
      const res = await POST(makeRequest({}));

      expect(res.status).toBe(400);
      expect(getUserPasswordAuthStateByEmail).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid JSON body', async () => {
      const req = new NextRequest(new URL('http://localhost:3000/api/auth/forgot-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not-json',
      });

      const res = await POST(req);

      expect(res.status).toBe(400);
      expect(getUserPasswordAuthStateByEmail).not.toHaveBeenCalled();
    });
  });
});
