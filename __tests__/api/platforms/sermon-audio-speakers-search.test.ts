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

import { GET } from '@/app/api/platforms/sermon-audio/speakers/search/route';

describe('GET /api/platforms/sermon-audio/speakers/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedUserId.mockResolvedValue('user-123');
    mockGetConnectedAccountWithTokens.mockResolvedValue({
      accessToken: 'sa-api-key',
      platformUserId: 'broadcaster-99',
    });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 400 when query is too short', async () => {
    const res = await GET(
      new NextRequest('http://localhost/api/platforms/sermon-audio/speakers/search?q=a')
    );
    expect(res.status).toBe(400);
  });

  it('searches speakers via SermonAudio multisearch', async () => {
    vi.mocked(global.fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('/v2/node/search');
      expect(url).toContain('searchFor=Speaker');
      expect(url).toContain('query=smith');
      return new Response(
        JSON.stringify({
          speakerResults: [{ speakerID: 99, displayName: 'Rev. Smith' }],
        }),
        { status: 200 }
      );
    });

    const res = await GET(
      new NextRequest('http://localhost/api/platforms/sermon-audio/speakers/search?q=smith')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([{ speakerID: 99, displayName: 'Rev. Smith' }]);
  });

  it('returns 503 when SermonAudio is temporarily unavailable', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response('Server error', { status: 503 }));

    const res = await GET(
      new NextRequest('http://localhost/api/platforms/sermon-audio/speakers/search?q=smith')
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.statusCode).toBe(503);
    expect(body.message).toContain('temporarily unavailable');
  });

  it('returns 400 when upstream rejects the stored API key', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    const res = await GET(
      new NextRequest('http://localhost/api/platforms/sermon-audio/speakers/search?q=smith')
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.statusCode).toBe(401);
    expect(body.message).toContain('invalid or revoked');
  });
});
