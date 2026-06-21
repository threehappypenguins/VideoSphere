/**
 * Integration-style tests for POST /api/livestreams/[id]/schedule
 *
 * Mocks YouTube livestream API helpers and repositories to assert key-slot
 * assignment and missing-stream-key validation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/auth', () => ({
  getAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/repositories/livestreams', () => ({
  getLivestreamById: vi.fn(),
  listArmedYouTubeLivestreamsForUser: vi.fn(),
  updateLivestream: vi.fn(),
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

vi.mock('@/lib/livestreams/sync-youtube-broadcast', () => ({
  syncLivestreamMetadataToYouTube: vi.fn(),
}));

vi.mock('@/lib/platforms/youtube-livestream-api', () => ({
  scheduleYouTubeLiveBroadcast: vi.fn(),
  findYouTubeLiveStreamIdByKey: vi.fn(),
  bindYouTubeBroadcastToStream: vi.fn(),
  getYouTubeBroadcastLifecycleStatus: vi.fn(),
}));

import { syncLivestreamMetadataToYouTube } from '@/lib/livestreams/sync-youtube-broadcast';
import { POST } from '@/app/api/livestreams/[id]/schedule/route';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import {
  getLivestreamById,
  listArmedYouTubeLivestreamsForUser,
  updateLivestream,
} from '@/lib/repositories/livestreams';
import { getConnectedAccountWithTokens } from '@/lib/repositories/connected-accounts';
import { requireYouTubeConnection } from '@/lib/platforms/youtube-api';
import {
  scheduleYouTubeLiveBroadcast,
  findYouTubeLiveStreamIdByKey,
  bindYouTubeBroadcastToStream,
  getYouTubeBroadcastLifecycleStatus,
} from '@/lib/platforms/youtube-livestream-api';
import type { ConnectedAccount, Livestream } from '@/types';

const USER_ID = 'user-123';
const LIVESTREAM_ID = 'livestream-abc';
const SCHEDULED_START = '2026-07-01T18:00:00.000Z';

function makeArmedLivestream(index: number, keySlot: 'main' | 'temp'): Livestream {
  return {
    id: `armed-${index}`,
    userId: USER_ID,
    status: 'scheduled',
    title: `Armed ${index}`,
    description: '',
    tags: [],
    visibility: 'public',
    targets: ['youtube'],
    platforms: {},
    scheduledStartTime: `2026-07-0${index + 1}T12:00:00.000Z`,
    keySlot,
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function baseDraftLivestream(): Livestream {
  return {
    id: LIVESTREAM_ID,
    userId: USER_ID,
    status: 'draft',
    title: 'Sunday Service',
    description: 'Live worship',
    tags: ['church'],
    visibility: 'public',
    targets: ['youtube'],
    platforms: {},
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeConnectedAccount(overrides: Partial<ConnectedAccount> = {}): ConnectedAccount {
  return {
    id: 'conn-yt',
    userId: USER_ID,
    platform: 'youtube',
    platformUserId: 'yt-channel',
    platformName: 'My Channel',
    tokenExpiry: new Date(Date.now() + 3600_000).toISOString(),
    hasRefreshToken: true,
    hasYoutubeMainStreamKey:
      overrides.youtubeMainStreamKey !== undefined
        ? Boolean(overrides.youtubeMainStreamKey?.trim())
        : true,
    hasYoutubeTempStreamKey:
      overrides.youtubeTempStreamKey !== undefined
        ? Boolean(overrides.youtubeTempStreamKey?.trim())
        : true,
    accessToken: 'access',
    refreshToken: 'refresh',
    youtubeMainStreamKey: 'main-stream-key',
    youtubeTempStreamKey: 'temp-stream-key',
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeScheduleRequest(): NextRequest {
  const url = new URL(`http://localhost:3000/api/livestreams/${LIVESTREAM_ID}/schedule`);
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'videosphere_session=test',
    },
    body: JSON.stringify({ scheduledStartTime: SCHEDULED_START }),
  });
}

function makeParams(id = LIVESTREAM_ID) {
  return { params: Promise.resolve({ id }) };
}

function mockYouTubeScheduleSuccess(): void {
  vi.mocked(scheduleYouTubeLiveBroadcast).mockResolvedValue({
    ok: true,
    broadcastId: 'broadcast-1',
  });
  vi.mocked(findYouTubeLiveStreamIdByKey).mockResolvedValue({
    ok: true,
    streamId: 'stream-1',
  });
  vi.mocked(bindYouTubeBroadcastToStream).mockResolvedValue({ ok: true });
  vi.mocked(getYouTubeBroadcastLifecycleStatus).mockResolvedValue({
    ok: true,
    lifeCycleStatus: 'ready',
  });
  vi.mocked(syncLivestreamMetadataToYouTube).mockResolvedValue({ ok: true, droppedTags: [] });
}

describe('POST /api/livestreams/[id]/schedule', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAuthenticatedUserId).mockResolvedValue(USER_ID);
    vi.mocked(requireYouTubeConnection).mockResolvedValue({
      ok: true,
      accessToken: 'yt-access-token',
    });
    vi.mocked(getLivestreamById).mockResolvedValue(baseDraftLivestream());
    vi.mocked(getConnectedAccountWithTokens).mockResolvedValue(makeConnectedAccount());
    mockYouTubeScheduleSuccess();
    vi.mocked(updateLivestream).mockImplementation(async (_id, patch) => ({
      ...baseDraftLivestream(),
      ...patch,
      status: patch.status ?? 'draft',
    }));
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it.each([
    { armedCount: 0, expectedSlot: 'main' as const },
    { armedCount: 1, expectedSlot: 'temp' as const },
    { armedCount: 2, expectedSlot: 'temp' as const },
    { armedCount: 5, expectedSlot: 'temp' as const },
  ])(
    'assigns keySlot=$expectedSlot when $armedCount armed livestream(s) exist',
    async ({ armedCount, expectedSlot }) => {
      const armed = Array.from({ length: armedCount }, (_, i) =>
        makeArmedLivestream(i, i === 0 ? 'main' : 'temp')
      );
      vi.mocked(listArmedYouTubeLivestreamsForUser).mockResolvedValue(armed);

      const res = await POST(makeScheduleRequest(), makeParams());
      expect(res.status).toBe(200);

      const finalUpdate = vi.mocked(updateLivestream).mock.calls.at(-1)?.[1];
      expect(finalUpdate?.keySlot).toBe(expectedSlot);
      expect(finalUpdate?.status).toBe('scheduled');
      expect(finalUpdate?.scheduledStartTime).toBe(SCHEDULED_START);
      expect(finalUpdate?.youtubeBroadcastId).toBe('broadcast-1');
      expect(finalUpdate?.youtubeBoundStreamId).toBe('stream-1');
    }
  );

  it('returns 400 when main stream key is missing and slot would be main', async () => {
    vi.mocked(listArmedYouTubeLivestreamsForUser).mockResolvedValue([]);
    vi.mocked(getConnectedAccountWithTokens).mockResolvedValue(
      makeConnectedAccount({ youtubeMainStreamKey: undefined })
    );

    const res = await POST(makeScheduleRequest(), makeParams());
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.message).toBe(
      'Add a main stream key on the Connections page before scheduling a livestream.'
    );
    expect(scheduleYouTubeLiveBroadcast).not.toHaveBeenCalled();
    expect(updateLivestream).not.toHaveBeenCalled();
  });

  it('returns 400 when temp stream key is missing and slot would be temp', async () => {
    vi.mocked(listArmedYouTubeLivestreamsForUser).mockResolvedValue([
      makeArmedLivestream(0, 'main'),
    ]);
    vi.mocked(getConnectedAccountWithTokens).mockResolvedValue(
      makeConnectedAccount({ youtubeTempStreamKey: undefined })
    );

    const res = await POST(makeScheduleRequest(), makeParams());
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.message).toBe(
      'Add a temporary stream key on the Connections page before scheduling another livestream.'
    );
    expect(scheduleYouTubeLiveBroadcast).not.toHaveBeenCalled();
    expect(updateLivestream).not.toHaveBeenCalled();
  });

  it('returns 409 when livestream is not a draft', async () => {
    vi.mocked(getLivestreamById).mockResolvedValue({
      ...baseDraftLivestream(),
      status: 'scheduled',
    });

    const res = await POST(makeScheduleRequest(), makeParams());
    expect(res.status).toBe(409);
    expect((await res.json()).message).toBe('This livestream has already been scheduled.');
  });

  it('syncs livestream metadata to YouTube after binding the broadcast', async () => {
    vi.mocked(listArmedYouTubeLivestreamsForUser).mockResolvedValue([]);

    const res = await POST(makeScheduleRequest(), makeParams());
    expect(res.status).toBe(200);

    expect(syncLivestreamMetadataToYouTube).toHaveBeenCalledWith(
      'yt-access-token',
      USER_ID,
      LIVESTREAM_ID,
      expect.objectContaining({ youtubeBroadcastId: 'broadcast-1' })
    );
  });

  it('returns 502 when YouTube metadata sync fails after binding', async () => {
    vi.mocked(listArmedYouTubeLivestreamsForUser).mockResolvedValue([]);
    vi.mocked(syncLivestreamMetadataToYouTube).mockResolvedValue({
      ok: false,
      details: 'quota exceeded',
    });

    const res = await POST(makeScheduleRequest(), makeParams());
    expect(res.status).toBe(502);
    expect((await res.json()).message).toBe('quota exceeded');
  });
});
