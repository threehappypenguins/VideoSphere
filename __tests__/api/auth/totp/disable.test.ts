import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedUserId = vi.hoisted(() => vi.fn());
const mockGetUserById = vi.hoisted(() => vi.fn());
const mockGetTotpSecret = vi.hoisted(() => vi.fn());
const mockVerifyTotpToken = vi.hoisted(() => vi.fn());
const mockDisableTotp = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

vi.mock('@/lib/repositories/users', () => ({
  getUserById: (...args: unknown[]) => mockGetUserById(...args),
  getTotpSecret: (...args: unknown[]) => mockGetTotpSecret(...args),
  disableTotp: (...args: unknown[]) => mockDisableTotp(...args),
}));

vi.mock('@/lib/auth/totp', () => ({
  verifyTotpToken: (...args: unknown[]) => mockVerifyTotpToken(...args),
}));

import { POST } from '@/app/api/auth/totp/disable/route';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/auth/totp/disable'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/totp/disable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedUserId.mockResolvedValue('user-1');
    mockGetUserById.mockResolvedValue({
      userId: 'user-1',
      authProvider: 'password',
    });
    mockGetTotpSecret.mockResolvedValue({ status: 'available', secret: 'decrypted-totp-secret' });
    mockVerifyTotpToken.mockResolvedValue(true);
    mockDisableTotp.mockResolvedValue(undefined);
  });

  it('returns 400 when TOTP is not enabled', async () => {
    mockGetTotpSecret.mockResolvedValueOnce({ status: 'disabled' });

    const res = await POST(makeRequest({ token: '123456' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Two-factor authentication is not enabled for this account.',
    });
    expect(mockVerifyTotpToken).not.toHaveBeenCalled();
  });

  it('returns 500 when TOTP is enabled but the secret is unavailable', async () => {
    mockGetTotpSecret.mockResolvedValueOnce({ status: 'unavailable' });

    const res = await POST(makeRequest({ token: '123456' }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'Two-factor authentication is temporarily unavailable.',
    });
    expect(mockVerifyTotpToken).not.toHaveBeenCalled();
    expect(mockDisableTotp).not.toHaveBeenCalled();
  });

  it('disables TOTP, verifies the code, and clears the trust cookie on success', async () => {
    const res = await POST(makeRequest({ token: '123456' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockVerifyTotpToken).toHaveBeenCalledWith('decrypted-totp-secret', '123456');
    expect(mockDisableTotp).toHaveBeenCalledWith('user-1');

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('videosphere_totp_trust=');
    expect(setCookie).toMatch(/Max-Age=0/i);
  });
});
