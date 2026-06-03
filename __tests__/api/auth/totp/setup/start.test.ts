import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedUserId = vi.hoisted(() => vi.fn());
const mockGetUserById = vi.hoisted(() => vi.fn());
const mockGenerateTotpSetup = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

vi.mock('@/lib/repositories/users', () => ({
  getUserById: (...args: unknown[]) => mockGetUserById(...args),
}));

vi.mock('@/lib/auth/totp', () => ({
  generateTotpSetup: (...args: unknown[]) => mockGenerateTotpSetup(...args),
}));

import { POST } from '@/app/api/auth/totp/setup/start/route';

const passwordProfile = {
  userId: 'user-abc',
  email: 'user@example.com',
  hasCompletedOnboarding: false,
  role: 'user' as const,
  authProvider: 'password' as const,
  $createdAt: '2026-01-01T00:00:00.000Z',
  $updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/auth/totp/setup/start'), {
    method: 'POST',
  });
}

describe('POST /api/auth/totp/setup/start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedUserId.mockResolvedValue('user-abc');
    mockGetUserById.mockResolvedValue(passwordProfile);
    mockGenerateTotpSetup.mockReturnValue({
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUri: 'otpauth://totp/VideoSphere:user%40example.com?secret=JBSWY3DPEHPK3PXP',
    });
  });

  it('returns 401 when not authenticated', async () => {
    mockGetAuthenticatedUserId.mockResolvedValueOnce(null);

    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Not authenticated.' });
    expect(mockGenerateTotpSetup).not.toHaveBeenCalled();
  });

  it('returns 403 for Google sign-in accounts', async () => {
    mockGetUserById.mockResolvedValueOnce({
      ...passwordProfile,
      authProvider: 'google',
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'Two-factor authentication is only available for password-based accounts.',
    });
    expect(mockGenerateTotpSetup).not.toHaveBeenCalled();
  });

  it('returns secret and otpauthUri for password-based accounts', async () => {
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUri: 'otpauth://totp/VideoSphere:user%40example.com?secret=JBSWY3DPEHPK3PXP',
    });
    expect(mockGenerateTotpSetup).toHaveBeenCalledWith('user@example.com');
  });
});
