import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bindYouTubeBroadcastToStream,
  buildWritableYouTubeVideoSnippet,
  deleteYouTubeLiveBroadcast,
  ensureYouTubeBroadcastBoundToStreamKey,
  findYouTubeLiveStreamIdByKey,
  getYouTubeBroadcastLifecycleStatus,
  getYouTubeLiveBroadcastMetadata,
  matchYouTubeLiveStreamIdByKey,
  pickBestYouTubeThumbnailUrl,
  scheduleYouTubeLiveBroadcast,
  setYouTubeBroadcastCategory,
  setYouTubeBroadcastSnippetMetadata,
  setYouTubeBroadcastVideoStatus,
  setYouTubeBroadcastTags,
  buildWritableYouTubeVideoStatus,
  updateYouTubeLiveBroadcast,
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

  it('prefers the active stream when multiple resources share a key', () => {
    expect(
      matchYouTubeLiveStreamIdByKey(
        [
          {
            id: 'stream-inactive',
            cdn: { ingestionInfo: { streamName: 'main-key-123' } },
            status: { streamStatus: 'inactive' },
          },
          {
            id: 'stream-active',
            cdn: { ingestionInfo: { streamName: 'main-key-123' } },
            status: { streamStatus: 'active' },
          },
        ],
        'main-key-123'
      )
    ).toBe('stream-active');
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
    expect(calledUrl).toContain('part=id%2Ccdn%2Cstatus');
    expect(calledUrl).toContain('mine=true');
    expect(calledUrl).toContain(
      'fields=items%28id%2Ccdn%2FingestionInfo%2FstreamName%2Cstatus%2FstreamStatus%29'
    );
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

describe('ensureYouTubeBroadcastBoundToStreamKey', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips bind when YouTube already has the expected stream bound', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchJson({
          items: [{ id: 'stream-b', cdn: { ingestionInfo: { streamName: 'lookup-key' } } }],
        })
      )
      .mockResolvedValueOnce(
        mockFetchJson({
          items: [{ contentDetails: { boundStreamId: 'stream-b' } }],
        })
      );

    const result = await ensureYouTubeBroadcastBoundToStreamKey(
      ACCESS_TOKEN,
      'broadcast-123',
      'lookup-key'
    );

    expect(result).toEqual({ ok: true, streamId: 'stream-b', rebound: false });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('binds and verifies when YouTube is bound to a different stream', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchJson({
          items: [{ id: 'stream-b', cdn: { ingestionInfo: { streamName: 'lookup-key' } } }],
        })
      )
      .mockResolvedValueOnce(
        mockFetchJson({
          items: [{ contentDetails: { boundStreamId: 'stream-old' } }],
        })
      )
      .mockResolvedValueOnce(mockFetchJson({ id: 'broadcast-123' }))
      .mockResolvedValueOnce(
        mockFetchJson({
          items: [{ contentDetails: { boundStreamId: 'stream-b' } }],
        })
      );

    const result = await ensureYouTubeBroadcastBoundToStreamKey(
      ACCESS_TOKEN,
      'broadcast-123',
      'lookup-key'
    );

    expect(result).toEqual({ ok: true, streamId: 'stream-b', rebound: true });
    expect(global.fetch).toHaveBeenCalledTimes(4);
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

describe('buildWritableYouTubeVideoSnippet', () => {
  it('keeps only writable snippet fields and preserves tag order', () => {
    const snippet = buildWritableYouTubeVideoSnippet(
      {
        title: 'Live Event',
        description: 'Desc',
        categoryId: '22',
        channelId: 'UC123',
        publishedAt: '2026-01-01T00:00:00Z',
        thumbnails: { default: { url: 'https://example.com/thumb.jpg' } },
      },
      { tags: ['this is', 'tag'] }
    );

    expect(snippet).toEqual({
      title: 'Live Event',
      description: 'Desc',
      categoryId: '22',
      tags: ['this is', 'tag'],
    });
  });

  it('applies defaultAudioLanguage from the patch', () => {
    const snippet = buildWritableYouTubeVideoSnippet(
      {
        title: 'Live Event',
        description: 'Desc',
        categoryId: '22',
        defaultAudioLanguage: 'en',
      },
      { defaultAudioLanguage: 'fr' }
    );

    expect(snippet.defaultAudioLanguage).toBe('fr');
  });
});

function parseFetchJsonBody(call: unknown): unknown {
  const init = (call as [string, RequestInit] | undefined)?.[1];
  return init?.body ? JSON.parse(String(init.body)) : null;
}

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
    const updateBody = parseFetchJsonBody(vi.mocked(global.fetch).mock.calls[1]);
    expect(updateBody).toEqual({
      id: 'video-1',
      snippet: {
        title: 'Live Event',
        description: 'Desc',
        categoryId: '27',
      },
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('setYouTubeBroadcastTags', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists the video snippet and updates tags in entry order', async () => {
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
                tags: ['old'],
              },
            },
          ],
        })
      )
      .mockResolvedValueOnce(mockFetchJson({ id: 'video-1' }))
      .mockResolvedValueOnce(
        mockFetchJson({
          items: [
            {
              id: 'video-1',
              snippet: {
                title: 'Live Event',
                tags: ['this is', 'tag'],
              },
            },
          ],
        })
      );

    const result = await setYouTubeBroadcastTags(ACCESS_TOKEN, 'video-1', ['this is', 'a', 'tag']);

    expect(result).toEqual({ ok: true });
    const updateBody = parseFetchJsonBody(vi.mocked(global.fetch).mock.calls[1]);
    expect(updateBody).toEqual({
      id: 'video-1',
      snippet: {
        title: 'Live Event',
        description: 'Desc',
        categoryId: '22',
        tags: ['this is', 'tag'],
      },
    });
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('lists the video snippet and updates tags', async () => {
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
                tags: ['old'],
              },
            },
          ],
        })
      )
      .mockResolvedValueOnce(mockFetchJson({ id: 'video-1' }))
      .mockResolvedValueOnce(
        mockFetchJson({
          items: [
            {
              id: 'video-1',
              snippet: {
                title: 'Live Event',
                tags: ['church', 'worship'],
              },
            },
          ],
        })
      );

    const result = await setYouTubeBroadcastTags(ACCESS_TOKEN, 'video-1', ['church', 'worship']);

    expect(result).toEqual({ ok: true });
    const updateBody = parseFetchJsonBody(vi.mocked(global.fetch).mock.calls[1]);
    expect(updateBody).toEqual({
      id: 'video-1',
      snippet: {
        title: 'Live Event',
        description: 'Desc',
        categoryId: '22',
        tags: ['church', 'worship'],
      },
    });
  });

  it('returns ok without calling YouTube when tags normalize to empty', async () => {
    const result = await setYouTubeBroadcastTags(ACCESS_TOKEN, 'video-1', ['', '   ']);

    expect(result).toEqual({ ok: true });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('setYouTubeBroadcastSnippetMetadata', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports tags YouTube omitted on read-back', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchJson({
          items: [
            {
              id: 'video-1',
              snippet: {
                title: 'Live Event',
                categoryId: '22',
              },
            },
          ],
        })
      )
      .mockResolvedValueOnce(mockFetchJson({ id: 'video-1' }))
      .mockResolvedValueOnce(
        mockFetchJson({
          items: [
            {
              id: 'video-1',
              snippet: {
                title: 'Live Event',
                tags: ['tag', 'this is'],
              },
            },
          ],
        })
      );

    const result = await setYouTubeBroadcastSnippetMetadata(ACCESS_TOKEN, 'video-1', {
      tags: ['this is', 'tag'],
    });

    expect(result).toEqual({ ok: true, droppedTags: [] });
  });

  it('waits for YouTube tag read-back when the first videos.list response is empty', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchJson({
          items: [
            {
              id: 'video-1',
              snippet: {
                title: 'Live Event',
                categoryId: '22',
              },
            },
          ],
        })
      )
      .mockResolvedValueOnce(mockFetchJson({ id: 'video-1' }))
      .mockResolvedValueOnce(
        mockFetchJson({
          items: [{ id: 'video-1', snippet: { title: 'Live Event', categoryId: '22' } }],
        })
      )
      .mockResolvedValueOnce(
        mockFetchJson({
          items: [
            {
              id: 'video-1',
              snippet: {
                title: 'Live Event',
                categoryId: '22',
                tags: ['these are', 'tags'],
              },
            },
          ],
        })
      );

    const result = await setYouTubeBroadcastSnippetMetadata(ACCESS_TOKEN, 'video-1', {
      tags: ['these are', 'tags'],
    });

    expect(result).toEqual({ ok: true, droppedTags: [] });
  });

  it('updates stream language without category or tags', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchJson({
          items: [
            {
              id: 'video-1',
              snippet: {
                title: 'Live Event',
                categoryId: '22',
              },
            },
          ],
        })
      )
      .mockResolvedValueOnce(mockFetchJson({ id: 'video-1' }));

    const result = await setYouTubeBroadcastSnippetMetadata(ACCESS_TOKEN, 'video-1', {
      defaultAudioLanguage: 'fr',
    });

    expect(result).toEqual({ ok: true, droppedTags: [] });
    const updateBody = parseFetchJsonBody(vi.mocked(global.fetch).mock.calls[1]);
    expect(updateBody).toEqual({
      id: 'video-1',
      snippet: {
        title: 'Live Event',
        categoryId: '22',
        defaultAudioLanguage: 'fr',
      },
    });
  });
});

describe('buildWritableYouTubeVideoStatus', () => {
  it('merges patch values with existing status and keeps privacyStatus', () => {
    const status = buildWritableYouTubeVideoStatus(
      {
        privacyStatus: 'public',
        license: 'youtube',
        publicStatsViewable: true,
      },
      {
        license: 'creativeCommon',
      }
    );

    expect(status).toEqual({
      privacyStatus: 'public',
      license: 'creativeCommon',
      publicStatsViewable: true,
    });
  });
});

describe('setYouTubeBroadcastVideoStatus', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('updates license in one videos.update call', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchJson({
          items: [
            {
              id: 'video-1',
              status: {
                privacyStatus: 'public',
                license: 'youtube',
                publicStatsViewable: true,
              },
            },
          ],
        })
      )
      .mockResolvedValueOnce(mockFetchJson({ id: 'video-1' }));

    const result = await setYouTubeBroadcastVideoStatus(ACCESS_TOKEN, 'video-1', {
      license: 'creativeCommon',
      privacyStatus: 'public',
    });

    expect(result).toEqual({ ok: true });
    const updateBody = parseFetchJsonBody(vi.mocked(global.fetch).mock.calls[1]);
    expect(updateBody).toEqual({
      id: 'video-1',
      status: {
        privacyStatus: 'public',
        license: 'creativeCommon',
        publicStatsViewable: true,
      },
    });
  });

  it('returns ok without calling YouTube when the patch is empty', async () => {
    const result = await setYouTubeBroadcastVideoStatus(ACCESS_TOKEN, 'video-1', {});

    expect(result).toEqual({ ok: true });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('uploadYouTubeLivestreamThumbnail', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads thumbnail bytes and returns the best available thumbnail URL', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchJson({
        items: [
          {
            default: { url: 'https://i.ytimg.com/vi/video-1/default.jpg' },
            high: { url: 'https://i.ytimg.com/vi/video-1/hqdefault.jpg' },
          },
        ],
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
      thumbnailUrl: 'https://i.ytimg.com/vi/video-1/hqdefault.jpg',
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

describe('updateYouTubeLiveBroadcast', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('PUTs snippet and status to liveBroadcasts.update', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(mockFetchJson({ id: 'broadcast-1' }));

    const result = await updateYouTubeLiveBroadcast(ACCESS_TOKEN, 'broadcast-1', {
      title: 'Sunday Service',
      description: 'Weekly worship',
      scheduledStartTime: '2026-07-01T18:00:00.000Z',
      privacyStatus: 'public',
      madeForKids: false,
    });

    expect(result).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://www.googleapis.com/youtube/v3/liveBroadcasts'),
      expect.objectContaining({
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: 'broadcast-1',
          snippet: {
            title: 'Sunday Service',
            description: 'Weekly worship',
            scheduledStartTime: '2026-07-01T18:00:00.000Z',
          },
          status: {
            privacyStatus: 'public',
            selfDeclaredMadeForKids: false,
          },
        }),
      })
    );
  });
});

describe('deleteYouTubeLiveBroadcast', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('DELETEs the broadcast by id', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await deleteYouTubeLiveBroadcast(ACCESS_TOKEN, 'broadcast-1');

    expect(result).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        'https://www.googleapis.com/youtube/v3/liveBroadcasts?id=broadcast-1'
      ),
      expect.objectContaining({
        method: 'DELETE',
      })
    );
  });
});

describe('pickBestYouTubeThumbnailUrl', () => {
  it('prefers the largest available thumbnail size', () => {
    expect(
      pickBestYouTubeThumbnailUrl({
        default: { url: 'https://i.ytimg.com/default.jpg' },
        high: { url: 'https://i.ytimg.com/high.jpg' },
        maxres: { url: 'https://i.ytimg.com/maxres.jpg' },
      })
    ).toBe('https://i.ytimg.com/maxres.jpg');
  });

  it('returns undefined when no usable thumbnail URLs are present', () => {
    expect(pickBestYouTubeThumbnailUrl({})).toBeUndefined();
    expect(pickBestYouTubeThumbnailUrl(null)).toBeUndefined();
  });
});

describe('getYouTubeLiveBroadcastMetadata', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not call playlistItems.list for scheduled ready broadcasts', async () => {
    vi.mocked(global.fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/liveBroadcasts?')) {
        return mockFetchJson({
          items: [
            {
              snippet: {
                title: 'Service',
                description: 'Desc',
                scheduledStartTime: '2026-07-01T18:00:00Z',
              },
              status: { privacyStatus: 'public', lifeCycleStatus: 'ready' },
            },
          ],
        });
      }
      if (url.includes('/videos?') && url.includes('part=snippet')) {
        return mockFetchJson({ items: [{ snippet: { tags: ['church'] } }] });
      }
      if (url.includes('/videos?') && url.includes('part=status')) {
        return mockFetchJson({ items: [{ status: { license: 'youtube' } }] });
      }
      if (url.includes('/playlistItems?')) {
        throw new Error('playlistItems.list should not be called for ready broadcasts');
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const result = await getYouTubeLiveBroadcastMetadata(ACCESS_TOKEN, 'broadcast-ready');

    expect(result.ok).toBe(true);
    if (!result.ok || !result.metadata) return;
    expect(result.metadata.lifeCycleStatus).toBe('ready');
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/playlistItems?'),
      expect.anything()
    );
  });
});
