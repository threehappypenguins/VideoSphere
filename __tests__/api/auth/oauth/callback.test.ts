import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUserByEmail = vi.hoisted(() => vi.fn());
const mockCreateUser = vi.hoisted(() => vi.fn());
const mockHasAnyUsers = vi.hoisted(() => vi.fn());
const mockIsSetupTokenValid = vi.hoisted(() => vi.fn());
const mockConsumeSetupToken = vi.hoisted(() => vi.fn());
const mockReleaseSetupToken = vi.hoisted(() => vi.fn());
const mockIsInviteTokenValid = vi.hoisted(() => vi.fn());
const mockConsumeInviteToken = vi.hoisted(() => vi.fn());
const mockReleaseInviteToken = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());
const mockJwtSign = vi.hoisted(() => vi.fn().mockResolvedValue('jwt-token'));

vi.mock('@/lib/repositories/users', () => ({
  getUserByEmail: (...args: unknown[]) => mockGetUserByEmail(...args),
  createUser: (...args: unknown[]) => mockCreateUser(...args),
}));

vi.mock('@/lib/repositories/invites', () => ({
  hasAnyUsers: (...args: unknown[]) => mockHasAnyUsers(...args),
  isSetupTokenValid: (...args: unknown[]) => mockIsSetupTokenValid(...args),
  consumeSetupToken: (...args: unknown[]) => mockConsumeSetupToken(...args),
  releaseSetupToken: (...args: unknown[]) => mockReleaseSetupToken(...args),
  isInviteTokenValid: (...args: unknown[]) => mockIsInviteTokenValid(...args),
  consumeInviteToken: (...args: unknown[]) => mockConsumeInviteToken(...args),
  releaseInviteToken: (...args: unknown[]) => mockReleaseInviteToken(...args),
}));

vi.mock('jose', () => ({
  SignJWT: class {
    setProtectedHeader() {
      return this;
    }

    setSubject() {
      return this;
    }

    setIssuedAt() {
      return this;
    }

    setExpirationTime() {
      return this;
    }

    sign() {
      return mockJwtSign();
    }
  },
}));

vi.stubGlobal('fetch', mockFetch);

import {
  GOOGLE_AUTH_OAUTH_STATE_COOKIE,
  buildGoogleOAuthStateCookie,
} from '@/lib/auth/google-oauth';
import { GET } from '@/app/api/auth/oauth/callback/route';

function makeRequest(params: Record<string, string> = {}, cookies: Record<string, string> = {}) {
  const url = new URL('http://localhost:3000/api/auth/oauth/callback');
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const cookieHeader = Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
  return new NextRequest(url, {
    method: 'GET',
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
  });
}

function mockGoogleSuccess() {
  mockFetch
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'access-token' }),
      text: async () => JSON.stringify({ access_token: 'access-token' }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        sub: 'google-subject',
        email: 'creator@example.com',
        email_verified: true,
        name: 'Creator Name',
      }),
      text: async () =>
        JSON.stringify({
          sub: 'google-subject',
          email: 'creator@example.com',
          email_verified: true,
          name: 'Creator Name',
        }),
    });
}

function loginCookie() {
  return {
    [GOOGLE_AUTH_OAUTH_STATE_COOKIE]: buildGoogleOAuthStateCookie({ nonce: 'nonce-123' }),
  };
}

function setupCookie(token = 'setup-token-1') {
  return {
    [GOOGLE_AUTH_OAUTH_STATE_COOKIE]: buildGoogleOAuthStateCookie({
      nonce: 'nonce-123',
      setupToken: token,
    }),
  };
}

function inviteCookie(token = 'invite-token-1') {
  return {
    [GOOGLE_AUTH_OAUTH_STATE_COOKIE]: buildGoogleOAuthStateCookie({
      nonce: 'nonce-123',
      inviteToken: token,
    }),
  };
}

function validRequest(cookies: Record<string, string>) {
  return makeRequest({ code: 'auth-code', state: 'nonce-123' }, cookies);
}

function expectOAuthStateCookieCleared(res: Response) {
  const setCookie = res.headers.get('set-cookie') ?? '';
  expect(setCookie).toMatch(/google_auth_oauth_state=;|google_auth_oauth_state=.*Max-Age=0/);
}

describe('GET /api/auth/oauth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    process.env.JWT_SECRET = 'test-jwt-secret-for-vitest-only';
    mockHasAnyUsers.mockResolvedValue(false);
    mockIsSetupTokenValid.mockResolvedValue(true);
    mockConsumeSetupToken.mockResolvedValue(true);
    mockIsInviteTokenValid.mockResolvedValue(true);
    mockConsumeInviteToken.mockResolvedValue({
      grantedRole: 'user',
      releaseSnapshot: {
        token: 'invite-token-1',
        grantedRole: 'user',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
  });

  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it('signs in and redirects to dashboard for existing login users', async () => {
    mockGoogleSuccess();
    mockGetUserByEmail.mockResolvedValueOnce({
      userId: 'existing-user-id',
      email: 'creator@example.com',
      role: 'user',
    });

    const res = await GET(validRequest(loginCookie()));

    expect(mockGetUserByEmail).toHaveBeenCalledWith('creator@example.com');
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3000/dashboard');
    expectOAuthStateCookieCleared(res);
  });

  it('clears the OAuth state cookie on early error redirects', async () => {
    const res = await GET(makeRequest({}, loginCookie()));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/login?error=oauth_missing_params'
    );
    expectOAuthStateCookieCleared(res);
  });

  it('redirects to login when Google account is not registered and flow is login', async () => {
    mockGoogleSuccess();
    mockGetUserByEmail.mockResolvedValueOnce(null);

    const res = await GET(validRequest(loginCookie()));

    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/login?error=oauth_registration_disabled'
    );
  });

  it('returns oauth_callback_failed when getUserByEmail throws on login', async () => {
    mockGoogleSuccess();
    mockGetUserByEmail.mockRejectedValueOnce(new Error('db unavailable'));

    const res = await GET(validRequest(loginCookie()));

    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/login?error=oauth_callback_failed'
    );
  });

  it('redirects oauth_setup_completed to login when setup is already complete', async () => {
    mockGoogleSuccess();
    mockHasAnyUsers.mockResolvedValueOnce(true);

    const res = await GET(validRequest(setupCookie()));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/login?error=oauth_setup_completed'
    );
  });

  it('redirects oauth_invite_invalid to the invite page when the invite token is invalid', async () => {
    mockGoogleSuccess();
    mockIsInviteTokenValid.mockResolvedValueOnce(false);

    const res = await GET(validRequest(inviteCookie()));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/invite/invite-token-1?error=oauth_invite_invalid'
    );
  });

  it('creates an admin user during first-run setup OAuth', async () => {
    mockGoogleSuccess();
    mockCreateUser.mockResolvedValueOnce({
      userId: 'new-admin-id',
      email: 'creator@example.com',
      role: 'admin',
    });

    const res = await GET(validRequest(setupCookie()));

    expect(mockIsSetupTokenValid).toHaveBeenCalledWith('setup-token-1');
    expect(mockConsumeSetupToken).toHaveBeenCalledWith('setup-token-1', expect.any(String));
    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'creator@example.com',
        name: 'Creator Name',
        role: 'admin',
      })
    );
    expect(res.headers.get('location')).toBe('http://localhost:3000/dashboard');
  });

  it('creates a user account during invite OAuth', async () => {
    mockGoogleSuccess();
    mockCreateUser.mockResolvedValueOnce({
      userId: 'new-user-id',
      email: 'creator@example.com',
      role: 'user',
    });

    const res = await GET(validRequest(inviteCookie()));

    expect(mockIsInviteTokenValid).toHaveBeenCalledWith('invite-token-1');
    expect(mockConsumeInviteToken).toHaveBeenCalledWith('invite-token-1', expect.any(String));
    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'creator@example.com',
        role: 'user',
      })
    );
    expect(res.headers.get('location')).toBe('http://localhost:3000/dashboard');
  });
});
