import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  reconcileLivestreamFromYouTubeById,
  reconcileLivestreamsFromYouTubeForUser,
} from '@/lib/livestreams/reconcile-user-lifecycle';
import type { Livestream } from '@/types';

vi.mock('@/lib/repositories/connected-accounts', () => ({
  getConnectedAccountWithTokens: vi.fn(),
}));

vi.mock('@/lib/repositories/livestreams', () => ({
  listLivestreamsByUser: vi.fn(),
  getLivestreamById: vi.fn(),
  updateLivestream: vi.fn(),
  deleteLivestream: vi.fn(),
}));

vi.mock('@/lib/platforms/token-refresh', () => ({
  refreshTokenIfNeeded: vi.fn(),
}));

vi.mock('@/lib/platforms/youtube-livestream-api', () => ({
  getYouTubeLiveBroadcastMetadata: vi.fn(),
}));

import {
  listLivestreamsByUser,
  getLivestreamById,
  updateLivestream,
  deleteLivestream,
} from '@/lib/repositories/livestreams';
import { getConnectedAccountWithTokens } from '@/lib/repositories/connected-accounts';
import { refreshTokenIfNeeded } from '@/lib/platforms/token-refresh';
import { getYouTubeLiveBroadcastMetadata } from '@/lib/platforms/youtube-livestream-api';

const USER_ID = 'user-1';

function makeLivestream(overrides: Partial<Livestream> & { id: string }): Livestream {
  return {
    userId: USER_ID,
    status: 'scheduled',
    title: 'Stream',
    description: '',
    tags: [],
    visibility: 'public',
    targets: ['youtube'],
    platforms: {},
    youtubeBroadcastId: `broadcast-${overrides.id}`,
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('reconcileLivestreamsFromYouTubeForUser', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getConnectedAccountWithTokens).mockResolvedValue({ id: 'acct-1' } as never);
    vi.mocked(refreshTokenIfNeeded).mockResolvedValue({ accessToken: 'yt-token' } as never);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('updates scheduled livestreams from YouTube metadata on list refresh', async () => {
    const row = makeLivestream({ id: 'ls-1', title: 'Old title' });
    vi.mocked(listLivestreamsByUser).mockResolvedValue([row]);
    vi.mocked(getYouTubeLiveBroadcastMetadata).mockResolvedValue({
      ok: true,
      metadata: {
        title: 'Updated in YouTube Studio',
        description: 'New description',
        tags: [],
        privacyStatus: 'public',
        lifeCycleStatus: 'ready',
      },
    });
    vi.mocked(updateLivestream).mockResolvedValue({
      ...row,
      title: 'Updated in YouTube Studio',
      description: 'New description',
      $updatedAt: '2026-01-02T00:00:00.000Z',
    });

    const updates = await reconcileLivestreamsFromYouTubeForUser(USER_ID);

    expect(updates).toBe(1);
    expect(updateLivestream).toHaveBeenCalledWith(
      'ls-1',
      expect.objectContaining({
        title: 'Updated in YouTube Studio',
        description: 'New description',
      })
    );
  });

  it('skips rows without a broadcast id or failed status', async () => {
    vi.mocked(listLivestreamsByUser).mockResolvedValue([
      makeLivestream({ id: 'draft', status: 'draft', youtubeBroadcastId: undefined }),
      makeLivestream({ id: 'failed', status: 'failed' }),
    ]);

    const updates = await reconcileLivestreamsFromYouTubeForUser(USER_ID);

    expect(updates).toBe(0);
    expect(getYouTubeLiveBroadcastMetadata).not.toHaveBeenCalled();
  });

  it('deletes local rows when YouTube no longer has the linked broadcast', async () => {
    const row = makeLivestream({ id: 'ls-deleted', title: 'Gone on YouTube' });
    vi.mocked(listLivestreamsByUser).mockResolvedValue([row]);
    vi.mocked(getYouTubeLiveBroadcastMetadata).mockResolvedValue({
      ok: true,
      metadata: null,
    });

    const updates = await reconcileLivestreamsFromYouTubeForUser(USER_ID);

    expect(updates).toBe(1);
    expect(deleteLivestream).toHaveBeenCalledWith('ls-deleted');
    expect(updateLivestream).not.toHaveBeenCalled();
  });
});

describe('reconcileLivestreamFromYouTubeById', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getConnectedAccountWithTokens).mockResolvedValue({ id: 'acct-1' } as never);
    vi.mocked(refreshTokenIfNeeded).mockResolvedValue({ accessToken: 'yt-token' } as never);
  });

  it('pulls YouTube metadata when opening a linked livestream', async () => {
    const row = makeLivestream({ id: 'ls-1', title: 'Before open' });
    vi.mocked(getLivestreamById).mockResolvedValue(row);
    vi.mocked(getYouTubeLiveBroadcastMetadata).mockResolvedValue({
      ok: true,
      metadata: {
        title: 'After open',
        description: '',
        tags: [],
        privacyStatus: 'public',
        lifeCycleStatus: 'ready',
      },
    });
    vi.mocked(updateLivestream).mockResolvedValue({
      ...row,
      title: 'After open',
      $updatedAt: '2026-01-02T00:00:00.000Z',
    });

    const result = await reconcileLivestreamFromYouTubeById(USER_ID, 'ls-1');

    expect(result?.title).toBe('After open');
    expect(getYouTubeLiveBroadcastMetadata).toHaveBeenCalledWith('yt-token', 'broadcast-ls-1');
  });

  it('returns null when YouTube deleted the linked broadcast', async () => {
    const row = makeLivestream({ id: 'ls-1', title: 'Before open' });
    vi.mocked(getLivestreamById).mockResolvedValue(row);
    vi.mocked(getYouTubeLiveBroadcastMetadata).mockResolvedValue({
      ok: true,
      metadata: null,
    });

    const result = await reconcileLivestreamFromYouTubeById(USER_ID, 'ls-1');

    expect(result).toBeNull();
    expect(deleteLivestream).toHaveBeenCalledWith('ls-1');
  });
});
