import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bindYouTubeBroadcastToStream,
  fetchYouTubeLiveCommentDefaults,
  findYouTubeLiveStreamIdByKey,
  getYouTubeBroadcastLifecycleStatus,
  matchYouTubeLiveStreamIdByKey,
  scheduleYouTubeLiveBroadcast,
  setYouTubeBroadcastCategory,
  uploadYouTubeLivestreamThumbnail,
} from '@/lib/platforms/youtube-livestream-api';

const ACCESS_TOKEN = 'yt-access-token';

function mockFetchJson(responseBody: unknown, init?: { ok?: boolean; status?: number }) {
  return new Response(JSON.stringify(responseBody), {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('matchYouTubeLiveStreamIdByKey', () => {
  it('returns the stream id when ingestion streamName matches', () => {
    expect(
      matchYouTubeLiveStreamIdByKey(
        [
          { id: 'stream-1', cdn: { ingestionInfo: { streamName: 'other-key' } } },
          { id: 'stream-2', cdn: { ingestionInfo: { streamName: 'main-key-123' } } },
        ],
        'main-key-123'
      )
    ).toBe('stream-2');
  });

  it('trims whitespace on the lookup key and stored streamName', () => {
    expect(
      matchYouTubeLiveStreamIdByKey(
        [{ id: 'stream-1', cdn: { ingestionInfo: { streamName: '  temp-key  ' } } }],
        ' temp-key '
      )
    ).toBe('stream-1');
  });

  it('returns null when no streamName matches', () => {
    expect(
      matchYouTubeLiveStreamIdByKey(
        [{ id: 'stream-1', cdn: { ingestionInfo: { streamName: 'abc' } } }],
        'xyz'
      )
    ).toBeNull();
  });

  it('returns null for an empty lookup key', () => {
    expect(
      matchYouTubeLiveStreamIdByKey(
        [{ id: 'stream-1', cdn: { ingestionInfo: { streamName: 'abc' } } }],
        '   '
      )
    ).toBeNull();
  });
});

describe('findYouTubeLiveStreamIdByKey', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the matching stream id from liveStreams.list', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchJson({
        items: [
          { id: 'stream-a', cdn: { ingestionInfo: { streamName: 'wrong' } } },
          { id: 'stream-b', cdn: { ingestionInfo: { streamName: 'lookup-key' } } },
        ],
      })
    );

    const result = await findYouTubeLiveStreamIdByKey(ACCESS_TOKEN, 'lookup-key');

    expect(result).toEqual({ ok: true, streamId: 'stream-b' });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://www.googleapis.com/youtube/v3/liveStreams?'),
      expect.objectContaining({
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
      })
    );
    const calledUrl = String(vi.mocked(global.fetch).mock.calls[0]?.[0]);
    expect(calledUrl).toContain('part=id%2Ccdn');
    expect(calledUrl).toContain('mine=true');
    expect(calledUrl).toContain('fields=items%28id%2Ccdn%2FingestionInfo%2FstreamName%29');
    expect(calledUrl).toContain('maxResults=50');
  });

  it('returns an error when no stream matches the key', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchJson({
        items: [{ id: 'stream-a', cdn: { ingestionInfo: { streamName: 'other' } } }],
      })
    );

    const result = await findYouTubeLiveStreamIdByKey(ACCESS_TOKEN, 'missing-key');

    expect(result).toEqual({
      ok: false,
      details: 'No YouTube live stream matched the provided stream key.',
    });
  });
});

describe('scheduleYouTubeLiveBroadcast', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('inserts a live broadcast with auto-start/stop and low-latency settings', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(mockFetchJson({ id: 'broadcast-123' }));

    const result = await scheduleYouTubeLiveBroadcast(ACCESS_TOKEN, {
      title: 'Sunday Service',
      description: 'Weekly livestream',
      scheduledStartTime: '2026-06-15T15:00:00.000Z',
      privacyStatus: 'unlisted',
      madeForKids: false,
    });

    expect(result).toEqual({ ok: true, broadcastId: 'broadcast-123' });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        'https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet%2Cstatus%2CcontentDetails'
      ),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          snippet: {
            title: 'Sunday Service',
            description: 'Weekly livestream',
            scheduledStartTime: '2026-06-15T15:00:00.000Z',
          },
          status: {
            privacyStatus: 'unlisted',
            selfDeclaredMadeForKids: false,
          },
          contentDetails: {
            enableAutoStart: true,
            enableAutoStop: true,
            enableLowLatency: true,
            enableDvr: true,
          },
        }),
      })
    );
  });
});

describe('bindYouTubeBroadcastToStream', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('binds a broadcast to a stream', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(mockFetchJson({ id: 'broadcast-123' }));

    const result = await bindYouTubeBroadcastToStream(ACCESS_TOKEN, 'broadcast-123', 'stream-456');

    expect(result).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        'https://www.googleapis.com/youtube/v3/liveBroadcasts/bind?id=broadcast-123&streamId=stream-456&part=id%2CcontentDetails'
      ),
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
      })
    );
  });
});

describe('setYouTubeBroadcastCategory', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists the video snippet and updates categoryId', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchJson({
          items: [
            {
              id: 'video-1',
              snippet: {
                title: 'Live Event',
                description: 'Desc',
                categoryId: '22',
              },
            },
          ],
        })
      )
      .mockResolvedValueOnce(mockFetchJson({ id: 'video-1' }));

    const result = await setYouTubeBroadcastCategory(ACCESS_TOKEN, 'video-1', '27');

    expect(result).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('https://www.googleapis.com/youtube/v3/videos?part=snippet'),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          id: 'video-1',
          snippet: {
            title: 'Live Event',
            description: 'Desc',
            categoryId: '27',
          },
        }),
      })
    );
  });
});

describe('uploadYouTubeLivestreamThumbnail', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads thumbnail bytes and returns the default thumbnail URL', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchJson({
        items: [{ default: { url: 'https://i.ytimg.com/vi/video-1/default.jpg' } }],
      })
    );

    const bytes = new Uint8Array([1, 2, 3, 4]);
    const result = await uploadYouTubeLivestreamThumbnail(
      ACCESS_TOKEN,
      'video-1',
      bytes,
      'image/jpeg'
    );

    expect(result).toEqual({
      ok: true,
      thumbnailUrl: 'https://i.ytimg.com/vi/video-1/default.jpg',
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        'https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=video-1&uploadType=media'
      ),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'image/jpeg',
          'Content-Length': '4',
        }),
      })
    );
  });
});

describe('getYouTubeBroadcastLifecycleStatus', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns lifeCycleStatus from liveBroadcasts.list', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchJson({
        items: [{ status: { lifeCycleStatus: 'ready' } }],
      })
    );

    const result = await getYouTubeBroadcastLifecycleStatus(ACCESS_TOKEN, 'broadcast-123');

    expect(result).toEqual({ ok: true, lifeCycleStatus: 'ready' });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        'https://www.googleapis.com/youtube/v3/liveBroadcasts?part=status&id=broadcast-123'
      ),
      expect.objectContaining({
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
      })
    );
  });

  it('returns null when the broadcast is not found', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(mockFetchJson({ items: [] }));

    const result = await getYouTubeBroadcastLifecycleStatus(ACCESS_TOKEN, 'missing');

    expect(result).toEqual({ ok: true, lifeCycleStatus: null });
  });
});

describe('fetchYouTubeLiveCommentDefaults', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads showViewerLikeCount from the most recent live broadcast video', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchJson({
          items: [
            {
              id: 'broadcast-old',
              snippet: { scheduledStartTime: '2026-01-01T12:00:00.000Z' },
            },
            {
              id: 'broadcast-new',
              snippet: { scheduledStartTime: '2026-06-01T12:00:00.000Z' },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        mockFetchJson({
          items: [
            { id: 'broadcast-old', status: { publicStatsViewable: true } },
            { id: 'broadcast-new', status: { publicStatsViewable: false } },
          ],
        })
      );

    const result = await fetchYouTubeLiveCommentDefaults(ACCESS_TOKEN);

    expect(result).toEqual({
      ok: true,
      defaults: {
        showViewerLikeCount: false,
      },
    });
    expect(String(vi.mocked(global.fetch).mock.calls[0]?.[0])).toContain(
      '/youtube/v3/liveBroadcasts'
    );
    expect(String(vi.mocked(global.fetch).mock.calls[1]?.[0])).toContain('id=broadcast-new');
  });

  it('falls back to the latest upload when the channel has no live broadcasts', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(mockFetchJson({ items: [] }))
      .mockResolvedValueOnce(
        mockFetchJson({
          items: [{ contentDetails: { relatedPlaylists: { uploads: 'UU-uploads' } } }],
        })
      )
      .mockResolvedValueOnce(
        mockFetchJson({
          items: [{ contentDetails: { videoId: 'upload-1' } }],
        })
      )
      .mockResolvedValueOnce(
        mockFetchJson({
          items: [{ status: { publicStatsViewable: true } }],
        })
      );

    const result = await fetchYouTubeLiveCommentDefaults(ACCESS_TOKEN);

    expect(result).toEqual({
      ok: true,
      defaults: {
        showViewerLikeCount: true,
      },
    });
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(4);
  });
});
