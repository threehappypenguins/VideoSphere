import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getAppBaseUrl } from '@/lib/auth/password-reset';

describe('getAppBaseUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prefers NEXT_PUBLIC_APP_URL over the request origin', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://videosphere.example.com/');

    const request = new NextRequest('http://evil.example/reset-password');
    expect(getAppBaseUrl(request)).toBe('https://videosphere.example.com');
  });

  it('falls back to the request origin when NEXT_PUBLIC_APP_URL is unset', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');

    const request = new NextRequest('http://localhost:3000/api/auth/forgot-password');
    expect(getAppBaseUrl(request)).toBe('http://localhost:3000');
  });

  it('defaults to localhost when neither env nor request is available', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');

    expect(getAppBaseUrl()).toBe('http://localhost:3000');
  });
});
