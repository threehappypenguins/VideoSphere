import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GOOGLE_AUTH_OAUTH_STATE_COOKIE,
  buildGoogleOAuthErrorRedirect,
  buildGoogleOAuthStateCookie,
  buildGoogleOAuthStartSearchParams,
  createGoogleOAuthStartRedirect,
  getGoogleOAuthClientId,
  parseGoogleOAuthStateCookie,
  revokeGoogleOAuthTokens,
} from '@/lib/auth/google-oauth';

describe('google-oauth state helpers', () => {
  it('round-trips setup flow state', () => {
    const cookie = buildGoogleOAuthStateCookie({
      nonce: 'nonce-abc',
      setupToken: 'setup-uuid',
    });

    const parsed = parseGoogleOAuthStateCookie(cookie);
    expect(parsed).toEqual({
      nonce: 'nonce-abc',
      redirectTo: null,
      flow: 'setup',
      setupToken: 'setup-uuid',
      inviteToken: null,
      userId: null,
    });
  });

  it('round-trips connect flow state with user id', () => {
    const cookie = buildGoogleOAuthStateCookie({
      nonce: 'nonce-connect',
      flow: 'connect',
      userId: 'user-abc',
      redirectTo: '/profile?success=google_connected',
    });

    const parsed = parseGoogleOAuthStateCookie(cookie);
    expect(parsed).toEqual({
      nonce: 'nonce-connect',
      redirectTo: '/profile?success=google_connected',
      flow: 'connect',
      setupToken: null,
      inviteToken: null,
      userId: 'user-abc',
    });
  });

  it('builds setup initiation query params', () => {
    expect(buildGoogleOAuthStartSearchParams({ setupToken: 'setup-uuid' })).toBe(
      '?setupToken=setup-uuid'
    );
  });

  it('redirects setup OAuth errors to the setup page with token', () => {
    expect(
      buildGoogleOAuthErrorRedirect('http://localhost:3000', 'oauth_initiation_failed', {
        setupToken: 'setup-uuid',
      })
    ).toBe('http://localhost:3000/setup?token=setup-uuid&error=oauth_initiation_failed');
  });

  it('redirects invite OAuth errors to the invite page', () => {
    expect(
      buildGoogleOAuthErrorRedirect('http://localhost:3000', 'oauth_initiation_failed', {
        inviteToken: 'invite-uuid',
      })
    ).toBe('http://localhost:3000/invite/invite-uuid?error=oauth_initiation_failed');
  });

  it('redirects login OAuth errors to the login page', () => {
    expect(buildGoogleOAuthErrorRedirect('http://localhost:3000', 'oauth_initiation_failed')).toBe(
      'http://localhost:3000/login?error=oauth_initiation_failed'
    );
  });

  it('redirects connect OAuth errors to the profile page', () => {
    expect(
      buildGoogleOAuthErrorRedirect('http://localhost:3000', 'oauth_connect_failed', {
        connect: true,
      })
    ).toBe('http://localhost:3000/profile?error=oauth_connect_failed');
  });
});

describe('createGoogleOAuthStartRedirect', () => {
  const originalClientId = process.env.GOOGLE_CLIENT_ID;

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  });

  afterEach(() => {
    if (originalClientId === undefined) {
      delete process.env.GOOGLE_CLIENT_ID;
    } else {
      process.env.GOOGLE_CLIENT_ID = originalClientId;
    }
  });

  it('returns null when client id is not configured', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect(getGoogleOAuthClientId()).toBeNull();
    expect(createGoogleOAuthStartRedirect('http://localhost:3000', {})).toBeNull();
  });

  it('redirects to Google with state cookie for login flow', () => {
    const res = createGoogleOAuthStartRedirect('http://localhost:3000', {
      redirectTo: '/dashboard',
    });

    expect(res?.status).toBe(307);
    const location = res?.headers.get('location') ?? '';
    expect(location).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
    expect(location).toContain('client_id=test-client-id');
    expect(location).toContain('access_type=offline');
    expect(location).not.toContain('prompt=consent');

    const setCookie = res?.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${GOOGLE_AUTH_OAUTH_STATE_COOKIE}=`);
  });

  it('adds prompt=consent when requested', () => {
    const res = createGoogleOAuthStartRedirect(
      'http://localhost:3000',
      { flow: 'connect', userId: 'user-abc' },
      { promptConsent: true }
    );

    expect(res?.headers.get('location')).toContain('prompt=consent');
    const setCookie = res?.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('connect');
    expect(setCookie).toContain('user-abc');
  });
});

describe('revokeGoogleOAuthTokens', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('revokes refresh token before access token when both are present', async () => {
    mockFetch.mockResolvedValue({ ok: true, text: async () => '' });

    await revokeGoogleOAuthTokens({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(String(mockFetch.mock.calls[0][0])).toBe('https://oauth2.googleapis.com/revoke');
    expect((mockFetch.mock.calls[0][1] as RequestInit).body).toBe('token=refresh-token');
    expect((mockFetch.mock.calls[1][1] as RequestInit).body).toBe('token=access-token');
  });

  it('does not call Google when no tokens are provided', async () => {
    await revokeGoogleOAuthTokens({});
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
