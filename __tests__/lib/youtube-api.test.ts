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

  it('lets latest-upload audio language override the channel default', async () => {
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
            items: [{ snippet: { defaultAudioLanguage: 'fr-CA' } }],
          });
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
});
