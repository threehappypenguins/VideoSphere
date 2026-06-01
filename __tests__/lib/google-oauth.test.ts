import { describe, expect, it } from 'vitest';
import {
  buildGoogleOAuthErrorRedirect,
  buildGoogleOAuthStateCookie,
  buildGoogleOAuthStartSearchParams,
  parseGoogleOAuthStateCookie,
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
