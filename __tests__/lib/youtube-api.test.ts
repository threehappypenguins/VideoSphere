import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchYouTubeAccountDefaults } from '@/lib/platforms/youtube-api';

describe('fetchYouTubeAccountDefaults', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('seeds defaultAudioLanguage from the channel when uploads playlist is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/youtube/v3/channels')) {
          return Response.json({
            items: [
              {
                snippet: { defaultLanguage: 'en-CA' },
                status: { madeForKids: false },
                contentDetails: { relatedPlaylists: {} },
              },
            ],
          });
        }
        if (url.includes('/youtube/v3/liveBroadcasts')) {
          return Response.json({ items: [] });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    const result = await fetchYouTubeAccountDefaults('token');

    expect(result).toEqual({
      ok: true,
      defaults: {
        madeForKids: false,
        defaultAudioLanguage: 'en-CA',
      },
    });
  });

  it('uses latest upload audio language only when the channel has no defaultLanguage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/youtube/v3/channels')) {
          return Response.json({
            items: [
              {
                snippet: {},
                brandingSettings: { channel: {} },
                contentDetails: { relatedPlaylists: { uploads: 'UU-uploads' } },
              },
            ],
          });
        }
        if (url.includes('/youtube/v3/playlistItems')) {
          return Response.json({
            items: [{ contentDetails: { videoId: 'vid-1' } }],
          });
        }
        if (url.includes('/youtube/v3/videos')) {
          return Response.json({
            items: [{ snippet: { defaultAudioLanguage: 'fr-CA', categoryId: '19' } }],
          });
        }
        if (url.includes('/youtube/v3/liveBroadcasts')) {
          return Response.json({ items: [] });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    const result = await fetchYouTubeAccountDefaults('token');

    expect(result).toEqual({
      ok: true,
      defaults: { defaultAudioLanguage: 'fr-CA' },
    });
  });

  it('keeps channel defaultLanguage when the latest upload has a different audio language', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/youtube/v3/channels')) {
          return Response.json({
            items: [
              {
                snippet: { defaultLanguage: 'en' },
                contentDetails: { relatedPlaylists: { uploads: 'UU-uploads' } },
              },
            ],
          });
        }
        if (url.includes('/youtube/v3/playlistItems')) {
          return Response.json({
            items: [{ contentDetails: { videoId: 'vid-1' } }],
          });
        }
        if (url.includes('/youtube/v3/videos')) {
          return Response.json({
            items: [{ snippet: { defaultAudioLanguage: 'fr-CA', categoryId: '19' } }],
          });
        }
        if (url.includes('/youtube/v3/liveBroadcasts')) {
          return Response.json({ items: [] });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    const result = await fetchYouTubeAccountDefaults('token');

    expect(result).toEqual({
      ok: true,
      defaults: {
        defaultAudioLanguage: 'en',
      },
    });
  });

  it('reads category from the nearest upcoming live broadcast instead of old uploads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/youtube/v3/channels')) {
          return Response.json({
            items: [
              {
                snippet: { defaultLanguage: 'en' },
                contentDetails: { relatedPlaylists: { uploads: 'UU-uploads' } },
              },
            ],
          });
        }
        if (url.includes('/youtube/v3/playlistItems')) {
          return Response.json({
            items: [{ contentDetails: { videoId: 'travel-video' } }],
          });
        }
        if (url.includes('/youtube/v3/videos') && url.includes('travel-video')) {
          return Response.json({
            items: [
              {
                id: 'travel-video',
                snippet: { categoryId: '19', defaultAudioLanguage: 'fr-CA' },
              },
            ],
          });
        }
        if (url.includes('/youtube/v3/liveBroadcasts')) {
          return Response.json({
            items: [
              {
                id: 'upcoming-live',
                snippet: { scheduledStartTime: '2026-12-01T18:00:00.000Z' },
              },
            ],
          });
        }
        if (url.includes('/youtube/v3/videos') && url.includes('upcoming-live')) {
          return Response.json({
            items: [
              {
                id: 'upcoming-live',
                snippet: { categoryId: '22' },
                status: { license: 'youtube', embeddable: true },
              },
            ],
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    const result = await fetchYouTubeAccountDefaults('token');

    expect(result).toEqual({
      ok: true,
      defaults: {
        defaultAudioLanguage: 'en',
        categoryId: '22',
        license: 'youtube',
        embeddable: true,
      },
    });
  });
});
