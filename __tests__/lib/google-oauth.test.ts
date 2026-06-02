import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildGoogleOAuthErrorRedirect,
  buildGoogleOAuthStateCookie,
  buildGoogleOAuthStartSearchParams,
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
