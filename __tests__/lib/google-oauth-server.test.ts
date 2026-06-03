import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GOOGLE_AUTH_OAUTH_STATE_COOKIE } from '@/lib/auth/google-oauth';
import {
  createGoogleOAuthStartRedirect,
  getGoogleOAuthClientId,
} from '@/lib/auth/google-oauth-server';

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
