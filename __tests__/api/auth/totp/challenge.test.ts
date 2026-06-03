import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockVerifyTotpChallengeToken = vi.hoisted(() => vi.fn());
const mockGetUserById = vi.hoisted(() => vi.fn());
const mockGetTotpSecret = vi.hoisted(() => vi.fn());
const mockVerifyTotpToken = vi.hoisted(() => vi.fn());
const mockIssueSessionResponse = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth/totp-jwt', () => ({
  verifyTotpChallengeToken: (...args: unknown[]) => mockVerifyTotpChallengeToken(...args),
  createTotpTrustToken: vi.fn(),
}));

vi.mock('@/lib/repositories/users', () => ({
  getUserById: (...args: unknown[]) => mockGetUserById(...args),
  getTotpSecret: (...args: unknown[]) => mockGetTotpSecret(...args),
}));

vi.mock('@/lib/auth/totp', () => ({
  verifyTotpToken: (...args: unknown[]) => mockVerifyTotpToken(...args),
}));

vi.mock('@/lib/auth/issue-session', () => ({
  issueSessionResponse: (...args: unknown[]) => mockIssueSessionResponse(...args),
}));

import { POST } from '@/app/api/auth/totp/challenge/route';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/auth/totp/challenge'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/totp/challenge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyTotpChallengeToken.mockResolvedValue('user-1');
    mockGetUserById.mockResolvedValue({
      userId: 'user-1',
      role: 'user',
    });
  });

  it('returns 400 when TOTP is not enabled', async () => {
    mockGetTotpSecret.mockResolvedValueOnce({ status: 'disabled' });

    const res = await POST(
      makeRequest({ tempToken: 'temp-token', token: '123456', rememberDevice: 'none' })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Two-factor authentication is not enabled for this account.',
    });
    expect(mockVerifyTotpToken).not.toHaveBeenCalled();
  });

  it('returns 500 when TOTP is enabled but the secret is unavailable', async () => {
    mockGetTotpSecret.mockResolvedValueOnce({ status: 'unavailable' });

    const res = await POST(
      makeRequest({ tempToken: 'temp-token', token: '123456', rememberDevice: 'none' })
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'Two-factor authentication is temporarily unavailable.',
    });
    expect(mockVerifyTotpToken).not.toHaveBeenCalled();
  });
});
