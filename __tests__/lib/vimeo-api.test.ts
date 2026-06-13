import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchVimeoAccountDefaults,
  fetchVimeoCategories,
  fetchVimeoContentRatings,
  fetchVimeoCreativeCommonsLicenses,
} from '@/lib/platforms/vimeo-api';

const SAMPLE_CONTENT_RATINGS = {
  data: [
    { code: 'safe', name: 'All audiences' },
    { code: 'violence', name: 'Violence' },
    { code: 'language', name: 'Language' },
    { code: 'drugs', name: 'Drugs' },
    { code: 'nudity', name: 'Nudity' },
    { code: 'unrated', name: 'Not Yet Rated' },
  ],
};

function mockContentRatingsResponse() {
  return Response.json(SAMPLE_CONTENT_RATINGS);
}

describe('fetchVimeoContentRatings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns all code/name rows from a paginated Vimeo response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: [
            { code: 'safe', name: 'All audiences' },
            { code: 'violence', name: 'Violence' },
            { code: 'explicit', name: 'Mature' },
          ],
        })
      )
    );

    const result = await fetchVimeoContentRatings('token');

    expect(result).toEqual({
      ok: true,
      items: [
        { code: 'safe', name: 'All audiences' },
        { code: 'violence', name: 'Violence' },
        { code: 'explicit', name: 'Mature' },
      ],
    });
  });
});

describe('fetchVimeoCategories', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns top-level categories with nested subcategories', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        expect(url).toContain('/categories');
        expect(url).toContain('per_page=100');

        return Response.json({
          data: [
            {
              uri: '/categories/animation',
              name: 'Animation',
              top_level: true,
              subcategories: [{ uri: '/categories/animation/subcategories/2d', name: '2D' }],
            },
            { uri: '/categories/animation/subcategories/2d', name: '2D', top_level: false },
          ],
        });
      })
    );

    const result = await fetchVimeoCategories('token');

    expect(result).toEqual({
      ok: true,
      items: [
        {
          uri: '/categories/animation',
          name: 'Animation',
          subcategories: [{ uri: '/categories/animation/subcategories/2d', name: '2D' }],
        },
      ],
    });
  });
});

describe('fetchVimeoCreativeCommonsLicenses', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns supported license code/name rows sorted by name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toContain('/creativecommons');

        return Response.json({
          data: [
            { code: 'by-sa', name: 'Attribution Share Alike' },
            { code: 'by-nc', name: 'Attribution Non-Commercial' },
            { code: 'unknown', name: 'Ignore Me' },
          ],
        });
      })
    );

    const result = await fetchVimeoCreativeCommonsLicenses('token');

    expect(result).toEqual({
      ok: true,
      items: [
        { code: 'by-nc', name: 'Attribution Non-Commercial' },
        { code: 'by-sa', name: 'Attribution Share Alike' },
      ],
    });
  });
});

describe('fetchVimeoAccountDefaults', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads upload default content rating and license from /me', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/contentratings')) {
          return mockContentRatingsResponse();
        }
        expect(url).toContain('/me');
        expect(url).toContain('fields=preferences.videos.license%2Cpreferences.videos.rating');

        return Response.json({
          preferences: {
            videos: {
              rating: ['safe'],
              license: 'by-sa',
            },
          },
        });
      })
    );

    const result = await fetchVimeoAccountDefaults('token');

    expect(result).toEqual({
      ok: true,
      defaults: {
        contentRating: ['safe'],
        license: 'by-sa',
      },
    });
  });

  it('preserves mature-detail default codes from /me', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/contentratings')) {
          return mockContentRatingsResponse();
        }

        return Response.json({
          preferences: {
            videos: {
              rating: ['language', 'violence'],
            },
          },
        });
      })
    );

    const result = await fetchVimeoAccountDefaults('token');

    expect(result).toEqual({
      ok: true,
      defaults: {
        contentRating: ['language', 'violence'],
      },
    });
  });

  it('omits contentRating when the user has no upload default configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/contentratings')) {
          return mockContentRatingsResponse();
        }

        return Response.json({
          preferences: {
            videos: {
              license: 'by-sa',
            },
          },
        });
      })
    );

    const result = await fetchVimeoAccountDefaults('token');

    expect(result).toEqual({
      ok: true,
      defaults: {
        license: 'by-sa',
      },
    });
  });
});
