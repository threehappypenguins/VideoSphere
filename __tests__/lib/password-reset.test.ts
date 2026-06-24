import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAppBaseUrl, getInternalAppOrigin } from '@/lib/app-port';

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

    expect(getAppBaseUrl()).toBe('http://localhost:9624');
  });
});

describe('getInternalAppOrigin', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses PORT when set', () => {
    vi.stubEnv('PORT', '3000');

    expect(getInternalAppOrigin()).toBe('http://127.0.0.1:3000');
  });

  it('defaults to APP_PORT when PORT is unset', () => {
    vi.stubEnv('PORT', '');

    expect(getInternalAppOrigin()).toBe('http://127.0.0.1:9624');
  });
});
