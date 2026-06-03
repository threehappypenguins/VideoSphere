import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedUserId = vi.hoisted(() => vi.fn());
const mockGetUserById = vi.hoisted(() => vi.fn());
const mockVerifyTotpToken = vi.hoisted(() => vi.fn());
const mockEncryptToken = vi.hoisted(() => vi.fn());
const mockEnableTotp = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

vi.mock('@/lib/repositories/users', () => ({
  getUserById: (...args: unknown[]) => mockGetUserById(...args),
  enableTotp: (...args: unknown[]) => mockEnableTotp(...args),
}));

vi.mock('@/lib/auth/totp', () => ({
  verifyTotpToken: (...args: unknown[]) => mockVerifyTotpToken(...args),
}));

vi.mock('@/lib/crypto/token-encryption', () => ({
  encryptToken: (...args: unknown[]) => mockEncryptToken(...args),
}));

import { POST } from '@/app/api/auth/totp/setup/verify/route';

const passwordProfile = {
  userId: 'user-abc',
  email: 'user@example.com',
  hasCompletedOnboarding: false,
  role: 'user' as const,
  authProvider: 'password' as const,
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:00:00.000Z',
};

const PENDING_SECRET = 'JBSWY3DPEHPK3PXP';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/auth/totp/setup/verify'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/totp/setup/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedUserId.mockResolvedValue('user-abc');
    mockGetUserById.mockResolvedValue(passwordProfile);
    mockVerifyTotpToken.mockResolvedValue(true);
    mockEncryptToken.mockReturnValue('encrypted-totp-secret');
    mockEnableTotp.mockResolvedValue(undefined);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetAuthenticatedUserId.mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ secret: PENDING_SECRET, token: '123456' }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Not authenticated.' });
    expect(mockVerifyTotpToken).not.toHaveBeenCalled();
  });

  it('returns 403 for Google sign-in accounts', async () => {
    mockGetUserById.mockResolvedValueOnce({
      ...passwordProfile,
      authProvider: 'google',
    });

    const res = await POST(makeRequest({ secret: PENDING_SECRET, token: '123456' }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'Two-factor authentication is only available for password-based accounts.',
    });
    expect(mockVerifyTotpToken).not.toHaveBeenCalled();
  });

  it('returns 400 when secret and token are not strings', async () => {
    const res = await POST(makeRequest({ secret: 123, token: null }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'secret and token are required and must be strings.',
    });
    expect(mockVerifyTotpToken).not.toHaveBeenCalled();
  });

  it('returns 400 when the authentication code is invalid', async () => {
    mockVerifyTotpToken.mockResolvedValueOnce(false);

    const res = await POST(makeRequest({ secret: PENDING_SECRET, token: '000000' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid authentication code.' });
    expect(mockVerifyTotpToken).toHaveBeenCalledWith(PENDING_SECRET, '000000');
    expect(mockEnableTotp).not.toHaveBeenCalled();
  });

  it('encrypts the secret and enables TOTP on success', async () => {
    const res = await POST(makeRequest({ secret: `  ${PENDING_SECRET}  `, token: '123456' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockVerifyTotpToken).toHaveBeenCalledWith(PENDING_SECRET, '123456');
    expect(mockEncryptToken).toHaveBeenCalledWith(PENDING_SECRET);
    expect(mockEnableTotp).toHaveBeenCalledWith('user-abc', 'encrypted-totp-secret');
  });
});
