import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reconcileLivestreamLifecycleForUser } from '@/lib/livestreams/reconcile-user-lifecycle';
import type { Livestream } from '@/types';

vi.mock('@/lib/repositories/connected-accounts', () => ({
  getConnectedAccountWithTokens: vi.fn(),
}));

vi.mock('@/lib/repositories/livestreams', () => ({
  listLivestreamsByUser: vi.fn(),
  updateLivestream: vi.fn(),
}));

vi.mock('@/lib/platforms/token-refresh', () => ({
  refreshTokenIfNeeded: vi.fn(),
}));

vi.mock('@/lib/platforms/youtube-livestream-api', () => ({
  getYouTubeBroadcastLifecycleStatus: vi.fn(),
}));

import { getConnectedAccountWithTokens } from '@/lib/repositories/connected-accounts';
import { listLivestreamsByUser, updateLivestream } from '@/lib/repositories/livestreams';
import { refreshTokenIfNeeded } from '@/lib/platforms/token-refresh';
import { getYouTubeBroadcastLifecycleStatus } from '@/lib/platforms/youtube-livestream-api';

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

describe('reconcileLivestreamLifecycleForUser', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getConnectedAccountWithTokens).mockResolvedValue({ id: 'acct-1' } as never);
    vi.mocked(refreshTokenIfNeeded).mockResolvedValue({ accessToken: 'yt-token' } as never);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('updates scheduled livestreams to live when YouTube reports testing', async () => {
    const row = makeLivestream({ id: 'ls-1', status: 'scheduled' });
    vi.mocked(listLivestreamsByUser).mockResolvedValue([row]);
    vi.mocked(getYouTubeBroadcastLifecycleStatus).mockResolvedValue({
      ok: true,
      lifeCycleStatus: 'testing',
    });
    vi.mocked(updateLivestream).mockResolvedValue({
      ...row,
      status: 'live',
      youtubeLifecycleStatus: 'testing',
    });

    const updates = await reconcileLivestreamLifecycleForUser(USER_ID);

    expect(updates).toBe(1);
    expect(updateLivestream).toHaveBeenCalledWith('ls-1', {
      youtubeLifecycleStatus: 'testing',
      status: 'live',
    });
  });

  it('skips rows without a broadcast id or ended status', async () => {
    vi.mocked(listLivestreamsByUser).mockResolvedValue([
      makeLivestream({ id: 'draft', status: 'draft', youtubeBroadcastId: undefined }),
      makeLivestream({ id: 'ended', status: 'ended' }),
    ]);

    const updates = await reconcileLivestreamLifecycleForUser(USER_ID);

    expect(updates).toBe(0);
    expect(getYouTubeBroadcastLifecycleStatus).not.toHaveBeenCalled();
  });
});
