import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedUserId = vi.fn();
const mockGetConnectedAccountWithTokens = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

vi.mock('@/lib/repositories/connected-accounts', () => ({
  getConnectedAccountWithTokens: (...args: unknown[]) => mockGetConnectedAccountWithTokens(...args),
}));

import { GET } from '@/app/api/platforms/sermon-audio/social-connections/route';

describe('GET /api/platforms/sermon-audio/social-connections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedUserId.mockResolvedValue('user-123');
    mockGetConnectedAccountWithTokens.mockResolvedValue({
      accessToken: 'sa-api-key',
      platformUserId: 'crpc',
    });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns Cross Publish connection flags from refresh_social', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          google: { hasOAUTH: false },
          facebook: { hasOAUTH: true, pageName: 'CRPC Facebook' },
          twitter: { hasOAUTH: true, name: 'CRPCHalifax' },
        }),
        { status: 200 }
      )
    );

    const res = await GET(
      new NextRequest('http://localhost/api/platforms/sermon-audio/social-connections')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      youtube: { connected: false },
      facebook: { connected: true, displayName: 'CRPC Facebook' },
      x: { connected: true, displayName: 'CRPCHalifax' },
    });

    const [url, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(String(url)).toBe(
      'https://api.sermonaudio.com/v2/node/broadcasters/crpc/refresh_social?cacheLanguage=en&cacheMax=181&cacheDomain=www.sermonaudio.com'
    );
    expect(init).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({ 'X-Api-Key': 'sa-api-key' }),
    });
  });

  it('returns 400 when upstream rejects the stored API key', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    const res = await GET(
      new NextRequest('http://localhost/api/platforms/sermon-audio/social-connections')
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.statusCode).toBe(400);
    expect(body.message).toContain('invalid or revoked');
  });
});
