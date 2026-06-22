/**
 * PATCH /api/livestreams/[id]/key-slot — switch main/temp YouTube stream key slot
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/repositories/livestreams', () => ({
  getLivestreamById: vi.fn(),
  listArmedYouTubeLivestreamsForUser: vi.fn(),
}));

vi.mock('@/lib/repositories/connected-accounts', () => ({
  getConnectedAccountWithTokens: vi.fn(),
}));

vi.mock('@/lib/platforms/youtube-api', () => ({
  requireYouTubeConnection: vi.fn(),
  youtubeUpstreamErrorResponse: vi.fn((details: string) =>
    Response.json({ error: 'Bad Gateway', message: details, statusCode: 502 }, { status: 502 })
  ),
}));

vi.mock('@/lib/livestreams/change-livestream-key-slot', () => ({
  changeLivestreamKeySlot: vi.fn(),
}));

import { PATCH } from '@/app/api/livestreams/[id]/key-slot/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { changeLivestreamKeySlot } from '@/lib/livestreams/change-livestream-key-slot';
import {
  getLivestreamById,
  listArmedYouTubeLivestreamsForUser,
} from '@/lib/repositories/livestreams';
import { getConnectedAccountWithTokens } from '@/lib/repositories/connected-accounts';
import {
  requireYouTubeConnection,
  youtubeUpstreamErrorResponse,
} from '@/lib/platforms/youtube-api';
import type { ConnectedAccount, Livestream } from '@/types';

const USER_ID = 'user-123';
const LIVESTREAM_ID = 'livestream-abc';

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost:3000/api/livestreams/${LIVESTREAM_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function scheduledLivestream(): Livestream {
  return {
    id: LIVESTREAM_ID,
    userId: USER_ID,
    status: 'scheduled',
    title: 'Sunday Service',
    description: '',
    tags: [],
    visibility: 'public',
    targets: ['youtube'],
    platforms: {},
    keySlot: 'main',
    youtubeBroadcastId: 'broadcast-1',
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function connectedAccount(): ConnectedAccount {
  return {
    id: 'conn-yt',
    userId: USER_ID,
    platform: 'youtube',
    platformUserId: 'yt-channel',
    platformName: 'My Channel',
    tokenExpiry: new Date(Date.now() + 3600_000).toISOString(),
    hasRefreshToken: true,
    hasYoutubeMainStreamKey: true,
    hasYoutubeTempStreamKey: true,
    accessToken: 'access',
    refreshToken: 'refresh',
    youtubeMainStreamKey: 'main-stream-key',
    youtubeTempStreamKey: 'temp-stream-key',
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('PATCH /api/livestreams/[id]/key-slot', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAuthenticatedUserId).mockResolvedValue(USER_ID);
    vi.mocked(requireYouTubeConnection).mockResolvedValue({
      ok: true,
      accessToken: 'access-token',
    });
    vi.mocked(getConnectedAccountWithTokens).mockResolvedValue(connectedAccount());
    vi.mocked(listArmedYouTubeLivestreamsForUser).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('returns 400 for invalid keySlot values', async () => {
    const res = await PATCH(makeRequest({ keySlot: 'backup' }), {
      params: Promise.resolve({ id: LIVESTREAM_ID }),
    });

    expect(res.status).toBe(400);
  });

  it('updates the slot and returns conflict warning metadata', async () => {
    const livestream = scheduledLivestream();
    vi.mocked(getLivestreamById).mockResolvedValueOnce(livestream);
    vi.mocked(changeLivestreamKeySlot).mockResolvedValueOnce({
      ok: true,
      livestream: { ...livestream, keySlot: 'temp' },
      conflict: {
        id: 'other',
        title: 'Youth Night',
        keySlot: 'temp',
      },
    });

    const res = await PATCH(makeRequest({ keySlot: 'temp' }), {
      params: Promise.resolve({ id: LIVESTREAM_ID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.keySlot).toBe('temp');
    expect(body.meta?.keySlotConflictWarning).toBe(
      '"Youth Night" is already scheduled with the temporary stream key. YouTube may detect multiple streams using the same stream key.'
    );
  });

  it('returns 409 for client-side key-slot conflicts instead of 502', async () => {
    vi.mocked(getLivestreamById).mockResolvedValueOnce(scheduledLivestream());
    vi.mocked(changeLivestreamKeySlot).mockResolvedValueOnce({
      ok: false,
      details: 'Only scheduled livestreams can change stream keys.',
      statusCode: 409,
    });

    const res = await PATCH(makeRequest({ keySlot: 'temp' }), {
      params: Promise.resolve({ id: LIVESTREAM_ID }),
    });

    expect(res.status).toBe(409);
    expect(youtubeUpstreamErrorResponse).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.error).toBe('Conflict');
  });

  it('returns 502 for YouTube upstream failures', async () => {
    vi.mocked(getLivestreamById).mockResolvedValueOnce(scheduledLivestream());
    vi.mocked(changeLivestreamKeySlot).mockResolvedValueOnce({
      ok: false,
      details: 'YouTube API error (503): unavailable',
      statusCode: 502,
    });

    const res = await PATCH(makeRequest({ keySlot: 'temp' }), {
      params: Promise.resolve({ id: LIVESTREAM_ID }),
    });

    expect(res.status).toBe(502);
    expect(youtubeUpstreamErrorResponse).toHaveBeenCalledWith(
      'YouTube API error (503): unavailable'
    );
  });
});
