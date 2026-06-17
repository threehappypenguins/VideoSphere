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

import { GET } from '@/app/api/platforms/sermon-audio/languages/route';

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/platforms/sermon-audio/languages', {
    method: 'GET',
  });
}

describe('GET /api/platforms/sermon-audio/languages', () => {
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

  it('fetches the paginated language catalog', async () => {
    vi.mocked(global.fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/v2/node/languages') && !url.includes('page=2')) {
        return new Response(
          JSON.stringify({
            results: [
              { languageCode: 'es', languageName: 'Spanish', localizedName: 'Español' },
              { languageCode: 'en', languageName: 'English', localizedName: 'English' },
            ],
            totalCount: 3,
            next: '/v2/node/languages?page=2',
          }),
          { status: 200 }
        );
      }

      if (url.includes('page=2')) {
        return new Response(
          JSON.stringify({
            results: [{ languageCode: 'de', languageName: 'German', localizedName: 'Deutsch' }],
            totalCount: 3,
            next: null,
          }),
          { status: 200 }
        );
      }

      return new Response('', { status: 404 });
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([
      { code: 'en', name: 'English' },
      { code: 'de', name: 'Deutsch' },
      { code: 'es', name: 'Español' },
    ]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not follow pagination URLs outside the SermonAudio API origin', async () => {
    vi.mocked(global.fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('api.sermonaudio.com');

      return new Response(
        JSON.stringify({
          results: [{ languageCode: 'en', languageName: 'English', localizedName: 'English' }],
          totalCount: 1,
          next: 'https://evil.example/ssrf',
        }),
        { status: 200 }
      );
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([{ code: 'en', name: 'English' }]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when SermonAudio is not connected', async () => {
    mockGetConnectedAccountWithTokens.mockResolvedValueOnce(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(404);
  });

  it('returns 400 when upstream rejects the stored API key', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.statusCode).toBe(400);
    expect(body.message).toContain('invalid or revoked');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
