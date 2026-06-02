import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAppBaseUrl } from '@/lib/auth/password-reset';

describe('getAppBaseUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses NEXT_PUBLIC_APP_URL when set', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://videosphere.example.com/');

    expect(getAppBaseUrl()).toBe('https://videosphere.example.com');
  });

  it('strips multiple trailing slashes from NEXT_PUBLIC_APP_URL', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://videosphere.example.com///');

    expect(getAppBaseUrl()).toBe('https://videosphere.example.com');
  });

  it('defaults to localhost when NEXT_PUBLIC_APP_URL is unset', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');

    expect(getAppBaseUrl()).toBe('http://localhost:3000');
  });
});
