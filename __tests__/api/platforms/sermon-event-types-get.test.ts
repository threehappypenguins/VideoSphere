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

import { GET } from '@/app/api/platforms/sermon-audio/filter-options/sermon-event-types/route';

function makeRequest(): NextRequest {
  return new NextRequest(
    'http://localhost:3000/api/platforms/sermon-audio/filter-options/sermon-event-types',
    { method: 'GET' }
  );
}

describe('GET /api/platforms/sermon-audio/filter-options/sermon-event-types', () => {
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

  it('fetches the global paginated sermon event type catalog without broadcaster_id', async () => {
    vi.mocked(global.fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/filter_options/sermon_event_types') && !url.includes('page=2')) {
        expect(url).not.toContain('broadcaster_id');
        return new Response(
          JSON.stringify({
            results: [{ description: 'Sunday Service' }],
            totalCount: 2,
            next: '/v2/node/filter_options/sermon_event_types?page=2',
          }),
          { status: 200 }
        );
      }

      if (url.includes('page=2')) {
        expect(url).not.toContain('broadcaster_id');
        return new Response(
          JSON.stringify({
            results: [{ description: 'Bible Study' }],
            totalCount: 2,
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
    expect(body.data).toEqual(expect.arrayContaining(['Bible Study', 'Sunday Service', 'Youth']));
    expect(body.data.length).toBeGreaterThan(6);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not follow pagination URLs outside the SermonAudio API origin', async () => {
    vi.mocked(global.fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('api.sermonaudio.com');

      return new Response(
        JSON.stringify({
          results: [{ description: 'Sunday Service' }],
          totalCount: 1,
          next: 'https://evil.example/ssrf',
        }),
        { status: 200 }
      );
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual(expect.arrayContaining(['Sunday Service', 'Youth']));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when SermonAudio is not connected', async () => {
    mockGetConnectedAccountWithTokens.mockResolvedValueOnce(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(404);
  });
});
