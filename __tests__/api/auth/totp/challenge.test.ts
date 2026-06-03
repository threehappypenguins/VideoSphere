import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mockVerifyTotpChallengeToken = vi.hoisted(() => vi.fn());
const mockCreateTotpTrustToken = vi.hoisted(() => vi.fn());
const mockGetUserById = vi.hoisted(() => vi.fn());
const mockGetTotpSecret = vi.hoisted(() => vi.fn());
const mockVerifyTotpToken = vi.hoisted(() => vi.fn());
const mockIssueSessionResponse = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth/totp-jwt', () => ({
  verifyTotpChallengeToken: (...args: unknown[]) => mockVerifyTotpChallengeToken(...args),
  createTotpTrustToken: (...args: unknown[]) => mockCreateTotpTrustToken(...args),
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
    mockGetTotpSecret.mockResolvedValue({ status: 'available', secret: 'totp-secret' });
    mockVerifyTotpToken.mockResolvedValue(true);
    mockIssueSessionResponse.mockResolvedValue(NextResponse.json({ ok: true }));
    mockCreateTotpTrustToken.mockResolvedValue('trust-token');
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

  it('issues a session for a valid challenge when rememberDevice is none', async () => {
    const res = await POST(
      makeRequest({ tempToken: 'temp-token', token: '123456', rememberDevice: 'none' })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockVerifyTotpChallengeToken).toHaveBeenCalledWith('temp-token');
    expect(mockVerifyTotpToken).toHaveBeenCalledWith('totp-secret', '123456');
    expect(mockIssueSessionResponse).toHaveBeenCalledWith('user-1', 'user');
    expect(mockCreateTotpTrustToken).not.toHaveBeenCalled();

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('videosphere_totp_trust=');
    expect(setCookie).toMatch(/Max-Age=0/i);
  });

  it('sets a trust cookie when rememberDevice is 30d', async () => {
    const res = await POST(
      makeRequest({ tempToken: 'temp-token', token: '123456', rememberDevice: '30d' })
    );

    expect(res.status).toBe(200);
    expect(mockCreateTotpTrustToken).toHaveBeenCalledWith('user-1', 60 * 60 * 24 * 30);
    expect(mockIssueSessionResponse).toHaveBeenCalledWith('user-1', 'user');

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('videosphere_totp_trust=trust-token');
  });
});
