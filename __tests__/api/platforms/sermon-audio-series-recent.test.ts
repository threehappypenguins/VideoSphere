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

import { GET } from '@/app/api/platforms/sermon-audio/series/recent/route';

describe('GET /api/platforms/sermon-audio/series/recent', () => {
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

  it('returns recent series derived from newest sermons', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            {
              preachDate: '2026-06-01',
              series: { seriesID: 10, title: 'Romans' },
            },
            {
              preachDate: '2026-05-25',
              series: { seriesID: 11, title: 'Genesis' },
            },
          ],
        }),
        { status: 200 }
      )
    );

    const res = await GET(
      new NextRequest('http://localhost/api/platforms/sermon-audio/series/recent')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([
      { seriesID: 10, title: 'Romans' },
      { seriesID: 11, title: 'Genesis' },
    ]);

    const [url] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(String(url)).toContain('/v2/node/sermons');
    expect(String(url)).toContain('broadcasterID=broadcaster-99');
    expect(String(url)).toContain('sortBy=newest');
  });
});
