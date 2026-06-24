import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { GET } from '@/app/api/auth/oauth/google/route';

function makeRequest(search = ''): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000/api/auth/oauth/google${search}`));
}

describe('GET /api/auth/oauth/google', () => {
  const originalClientId = process.env.GOOGLE_CLIENT_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (originalClientId === undefined) {
      delete process.env.GOOGLE_CLIENT_ID;
    } else {
      process.env.GOOGLE_CLIENT_ID = originalClientId;
    }
  });

  it('redirects setup initiation failures back to the setup page', async () => {
    delete process.env.GOOGLE_CLIENT_ID;

    const res = await GET(makeRequest('?setupToken=setup-token-1'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/setup?token=setup-token-1&error=oauth_initiation_failed'
    );
  });

  it('redirects invite initiation failures back to the invite page', async () => {
    delete process.env.GOOGLE_CLIENT_ID;

    const res = await GET(makeRequest('?inviteToken=invite-token-1'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/invite/invite-token-1?error=oauth_initiation_failed'
    );
  });

  it('redirects login initiation failures to the login page', async () => {
    delete process.env.GOOGLE_CLIENT_ID;

    const res = await GET(makeRequest());

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/login?error=oauth_initiation_failed'
    );
  });

  it('uses NEXT_PUBLIC_APP_URL for Google redirect_uri, not the request host', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://my.domain.com');

    const res = await GET(makeRequest());

    expect(res.status).toBe(307);
    const location = res.headers.get('location')!;
    const redirectUri = new URL(location).searchParams.get('redirect_uri');
    expect(redirectUri).toBe('https://my.domain.com/api/auth/oauth/callback');
  });
});
