import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAuthenticatedUserId = vi.fn();
const mockCreateConnectedAccount = vi.fn();
const mockGetConnectedAccount = vi.fn();
const mockUpdateConnection = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => mockGetAuthenticatedUserId(...args),
}));

vi.mock('@/lib/repositories/connected-accounts', () => ({
  createConnectedAccount: (...args: unknown[]) => mockCreateConnectedAccount(...args),
  getConnectedAccount: (...args: unknown[]) => mockGetConnectedAccount(...args),
  updateConnection: (...args: unknown[]) => mockUpdateConnection(...args),
}));

import { POST } from '@/app/api/platforms/connect/sermon-audio/route';

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/platforms/connect/sermon-audio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  apiKey: 'sa-api-key',
  broadcasterID: 'broadcaster-123',
  label: 'My Church',
};

const mockAccount = {
  id: 'ca-sa-1',
  userId: 'user-123',
  platform: 'sermon_audio',
  tokenExpiry: '9999-12-31T00:00:00.000Z',
  hasRefreshToken: false,
  platformUserId: 'broadcaster-123',
  platformName: 'My Church',
  $createdAt: new Date().toISOString(),
  $updatedAt: new Date().toISOString(),
};

describe('POST /api/platforms/connect/sermon-audio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    mockGetAuthenticatedUserId.mockResolvedValue('user-123');
    mockGetConnectedAccount.mockResolvedValue(null);
    mockCreateConnectedAccount.mockResolvedValue(mockAccount);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('returns 200 on success when SA broadcaster lookup succeeds', async () => {
    const res = await POST(createRequest(validBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.account).toEqual(mockAccount);
    expect(mockCreateConnectedAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-123',
        platform: 'sermon_audio',
        accessToken: 'sa-api-key',
        refreshToken: '',
        platformUserId: 'broadcaster-123',
        platformName: 'My Church',
      })
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.sermonaudio.com/v2/node/broadcasters/broadcaster-123',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'X-Api-Key': 'sa-api-key',
          Accept: 'application/json',
        }),
      })
    );
  });

  it('returns 400 when apiKey is missing', async () => {
    const res = await POST(createRequest({ broadcasterID: 'broadcaster-123' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('SERMONAUDIO_API_KEY_REQUIRED');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockCreateConnectedAccount).not.toHaveBeenCalled();
  });

  it('returns 400 when broadcasterID is missing', async () => {
    const res = await POST(createRequest({ apiKey: 'sa-api-key' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('SERMONAUDIO_BROADCASTER_ID_REQUIRED');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockCreateConnectedAccount).not.toHaveBeenCalled();
  });

  it('returns 400 when SA broadcaster lookup returns 401', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
    const res = await POST(createRequest(validBody));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('SERMONAUDIO_CREDENTIALS_INVALID');
    expect(body.error.statusCode).toBe(401);
    expect(mockCreateConnectedAccount).not.toHaveBeenCalled();
  });

  it('returns 400 when SA broadcaster lookup returns 404', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response('Not found', { status: 404 }));
    const res = await POST(createRequest(validBody));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('SERMONAUDIO_CREDENTIALS_INVALID');
    expect(body.error.statusCode).toBe(404);
    expect(mockCreateConnectedAccount).not.toHaveBeenCalled();
  });

  it('returns 503 when SA broadcaster lookup is rate limited', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response('Too Many Requests', { status: 429 })
    );
    const res = await POST(createRequest(validBody));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('SERMONAUDIO_UPSTREAM_UNAVAILABLE');
    expect(body.error.statusCode).toBe(429);
    expect(mockCreateConnectedAccount).not.toHaveBeenCalled();
  });

  it('returns 502 when SA broadcaster lookup returns an upstream 5xx error', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response('Server error', { status: 500 }));
    const res = await POST(createRequest(validBody));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe('SERMONAUDIO_UPSTREAM_UNAVAILABLE');
    expect(body.error.statusCode).toBe(500);
    expect(mockCreateConnectedAccount).not.toHaveBeenCalled();
  });
});
