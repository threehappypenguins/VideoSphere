import { describe, expect, it } from 'vitest';
import {
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
});
