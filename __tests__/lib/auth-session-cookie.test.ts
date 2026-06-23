import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSessionCookieOptions, getTotpTrustCookieOptions } from '@/lib/auth-session-cookie';

describe('auth session cookie options', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('omits Secure when NEXT_PUBLIC_APP_URL is http (homelab LAN)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://192.168.1.38:9624');

    expect(getSessionCookieOptions().secure).toBe(false);
    expect(getTotpTrustCookieOptions(3600).secure).toBe(false);
  });

  it('uses Secure when NEXT_PUBLIC_APP_URL is https', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://videosphere.example.com');

    expect(getSessionCookieOptions().secure).toBe(true);
  });

  it('respects JWT_SESSION_COOKIE_SECURE override', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://192.168.1.38:9624');
    vi.stubEnv('JWT_SESSION_COOKIE_SECURE', 'true');

    expect(getSessionCookieOptions().secure).toBe(true);
  });

  it('defaults to Secure in production when app URL is unset', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');

    expect(getSessionCookieOptions().secure).toBe(true);
  });
});
