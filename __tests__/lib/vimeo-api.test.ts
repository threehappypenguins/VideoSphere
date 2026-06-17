import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchVimeoAccountDefaults,
  fetchVimeoCategories,
  fetchVimeoCategorySubcategories,
  fetchVimeoContentRatings,
  fetchVimeoCreativeCommonsLicenses,
  fetchVimeoDraftMetadataOptions,
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

/** Collects request URLs from a stubbed `fetch` mock. */
function fetchRequestUrls(mockFetch: ReturnType<typeof vi.fn>): string[] {
  return mockFetch.mock.calls.map(([input]) => String(input));
}

/** Counts stubbed `fetch` calls whose URL contains `fragment`. */
function fetchCallCountForUrl(mockFetch: ReturnType<typeof vi.fn>, fragment: string): number {
  return fetchRequestUrls(mockFetch).filter((url) => url.includes(fragment)).length;
}

function mockMissingSupplementalCategoryDetail(url: string): Response | null {
  const match = String(url).match(/^https:\/\/api\.vimeo\.com\/categories\/([a-z0-9]+)$/i);
  if (!match) {
    return null;
  }

  const slug = match[1].toLowerCase();
  const supplementalSlugs = new Set([
    'wedding',
    'events',
    'fashion',
    'technology',
    'food',
    'art',
    'personal',
    'howto',
    'product',
    'talks',
  ]);
  if (!supplementalSlugs.has(slug)) {
    return null;
  }

  return new Response(null, { status: 404 });
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
        const missingSupplemental = mockMissingSupplementalCategoryDetail(url);
        if (missingSupplemental) {
          return missingSupplemental;
        }

        expect(url).toContain('/categories');
        expect(url).toContain('per_page=100');
        expect(url).not.toContain('fields=');

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
          mayHaveSubcategories: true,
        },
      ],
    });
  });

  it('follows relative paging.next links when loading the category list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const missingSupplemental = mockMissingSupplementalCategoryDetail(url);
        if (missingSupplemental) {
          return missingSupplemental;
        }

        if (url.includes('/categories?') && url.includes('page=2')) {
          expect(url.startsWith('https://api.vimeo.com/')).toBe(true);
          return Response.json({
            data: [{ uri: '/categories/music', name: 'Music', top_level: true }],
          });
        }

        if (url.includes('/categories?')) {
          return Response.json({
            data: [{ uri: '/categories/animation', name: 'Animation', top_level: true }],
            paging: { next: '/categories?page=2&per_page=100&sort=name&direction=asc' },
          });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    const result = await fetchVimeoCategories('token');

    expect(result).toEqual({
      ok: true,
      items: [
        {
          uri: '/categories/animation',
          name: 'Animation',
          subcategories: [],
          mayHaveSubcategories: false,
        },
        {
          uri: '/categories/music',
          name: 'Music',
          subcategories: [],
          mayHaveSubcategories: false,
        },
      ],
    });
  });

  it('fills subcategories from the dedicated collection endpoint when list and detail omit them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/categories/brandedcontent/subcategories')) {
          return Response.json({
            data: [
              {
                uri: '/categories/brandedcontent/brandeddoc',
                name: 'Documentary',
                top_level: false,
              },
              {
                uri: '/categories/brandedcontent/smallbusiness',
                name: 'Small Business',
                top_level: false,
              },
            ],
          });
        }

        if (url.includes('/categories/brandedcontent') && !url.includes('/categories?')) {
          return Response.json({
            uri: '/categories/brandedcontent',
            name: 'Branded Content',
            top_level: true,
          });
        }

        if (url.includes('/categories?')) {
          return Response.json({
            data: [
              {
                uri: '/categories/brandedcontent',
                name: 'Branded Content',
                top_level: true,
              },
            ],
          });
        }

        const missingSupplemental = mockMissingSupplementalCategoryDetail(url);
        if (missingSupplemental) {
          return missingSupplemental;
        }

        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    const result = await fetchVimeoCategories('token');

    expect(result).toEqual({
      ok: true,
      items: [
        {
          uri: '/categories/brandedcontent',
          name: 'Branded Content',
          subcategories: [
            { uri: '/categories/brandedcontent/brandeddoc', name: 'Documentary' },
            { uri: '/categories/brandedcontent/smallbusiness', name: 'Small Business' },
          ],
          mayHaveSubcategories: true,
        },
      ],
    });
  });

  it('does not attach unrelated flat-list rows as subcategories', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/categories/comedy') && !url.includes('/categories?')) {
          return Response.json({
            uri: '/categories/comedy',
            name: 'Comedy',
            top_level: true,
            subcategories: [],
          });
        }

        if (url.includes('/categories/travel') && !url.includes('/categories?')) {
          return Response.json({
            uri: '/categories/travel',
            name: 'Travel',
            top_level: true,
            subcategories: [],
          });
        }

        if (url.includes('/categories/africa') && !url.includes('/categories?')) {
          return Response.json({
            uri: '/categories/africa',
            name: 'Africa',
            top_level: true,
            subcategories: [],
          });
        }

        if (url.includes('/categories/comedy/subcategories')) {
          return Response.json({
            data: [
              {
                uri: '/categories/comedy/videos',
                name: 'Videos',
                top_level: false,
              },
              {
                uri: '/categories/comedy/sketch',
                name: 'Sketch',
                top_level: true,
              },
            ],
          });
        }

        if (url.includes('/categories/travel/subcategories')) {
          return Response.json({
            data: [
              {
                uri: '/categories/travel/africa',
                name: 'Africa',
                top_level: false,
              },
            ],
          });
        }

        if (url.includes('/categories/africa/subcategories')) {
          return Response.json({ data: [] });
        }

        if (url.includes('/categories?')) {
          return Response.json({
            data: [
              { uri: '/categories/comedy', name: 'Comedy', top_level: true },
              { uri: '/categories/travel', name: 'Travel', top_level: true },
              { uri: '/categories/africa', name: 'Africa', top_level: true },
              {
                uri: '/categories/comedy/sketch',
                name: 'Sketch',
                top_level: false,
              },
              {
                uri: '/categories/travel/africa',
                name: 'Africa',
                top_level: false,
              },
            ],
          });
        }

        const missingSupplemental = mockMissingSupplementalCategoryDetail(url);
        if (missingSupplemental) {
          return missingSupplemental;
        }

        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    const result = await fetchVimeoCategories('token');

    expect(result).toEqual({
      ok: true,
      items: [
        {
          uri: '/categories/africa',
          name: 'Africa',
          subcategories: [],
          mayHaveSubcategories: false,
        },
        {
          uri: '/categories/comedy',
          name: 'Comedy',
          subcategories: [],
          mayHaveSubcategories: false,
        },
        {
          uri: '/categories/travel',
          name: 'Travel',
          subcategories: [],
          mayHaveSubcategories: false,
        },
      ],
    });
  });

  it('includes single-segment list rows as top-level even when parent metadata is present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/categories/wedding') && !url.includes('/categories?')) {
          return Response.json({
            uri: '/categories/wedding',
            name: 'Wedding',
            top_level: true,
            subcategories: [],
          });
        }

        if (url.includes('/categories/wedding/subcategories')) {
          return Response.json({ data: [] });
        }

        if (url.includes('/categories?')) {
          return Response.json({
            data: [
              {
                uri: '/categories/wedding',
                name: 'Wedding',
                top_level: false,
                parent: { uri: '/categories/events', name: 'Events' },
              },
            ],
          });
        }

        const missingSupplemental = mockMissingSupplementalCategoryDetail(url);
        if (missingSupplemental) {
          return missingSupplemental;
        }

        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    const result = await fetchVimeoCategories('token');

    expect(result).toEqual({
      ok: true,
      items: [
        {
          uri: '/categories/wedding',
          name: 'Wedding',
          subcategories: [],
          mayHaveSubcategories: false,
        },
      ],
    });
  });

  it('includes supplemental upload categories omitted from the paginated list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/categories/wedding') && !url.includes('/categories?')) {
          return Response.json({
            uri: '/categories/wedding',
            name: 'Wedding',
            top_level: true,
          });
        }

        if (url.includes('/categories?')) {
          return Response.json({
            data: [
              {
                uri: '/categories/comedy',
                name: 'Comedy',
                top_level: true,
              },
            ],
          });
        }

        const missingSupplemental = mockMissingSupplementalCategoryDetail(url);
        if (missingSupplemental) {
          return missingSupplemental;
        }

        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    const result = await fetchVimeoCategories('token');

    expect(result).toEqual({
      ok: true,
      items: [
        {
          uri: '/categories/comedy',
          name: 'Comedy',
          subcategories: [],
          mayHaveSubcategories: false,
        },
        {
          uri: '/categories/wedding',
          name: 'Wedding',
          subcategories: [],
          mayHaveSubcategories: false,
        },
      ],
    });
  });

  it('does not load dedicated subcategories for comedy when list and detail omit them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/categories/comedy/subcategories')) {
          throw new Error('Comedy should not use the dedicated subcategories endpoint');
        }

        if (url.includes('/categories/comedy') && !url.includes('/categories?')) {
          return Response.json({
            uri: '/categories/comedy',
            name: 'Comedy',
            top_level: true,
            subcategories: [],
          });
        }

        if (url.includes('/categories?')) {
          return Response.json({
            data: [{ uri: '/categories/comedy', name: 'Comedy', top_level: true }],
          });
        }

        const missingSupplemental = mockMissingSupplementalCategoryDetail(url);
        if (missingSupplemental) {
          return missingSupplemental;
        }

        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    const result = await fetchVimeoCategories('token');

    expect(result).toEqual({
      ok: true,
      items: [
        {
          uri: '/categories/comedy',
          name: 'Comedy',
          subcategories: [],
          mayHaveSubcategories: false,
        },
      ],
    });
  });

  it('loads branded subs from the dedicated endpoint when detail returns an empty subcategories array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/categories/brandedcontent/subcategories')) {
          return Response.json({
            data: [
              {
                uri: '/categories/brandedcontent/brandeddoc',
                name: 'Documentary',
                top_level: false,
              },
            ],
          });
        }

        if (url.includes('/categories/brandedcontent') && !url.includes('/categories?')) {
          return Response.json({
            uri: '/categories/brandedcontent',
            name: 'Branded Content',
            top_level: true,
            subcategories: [],
          });
        }

        if (url.includes('/categories?')) {
          return Response.json({
            data: [
              {
                uri: '/categories/brandedcontent',
                name: 'Branded Content',
                top_level: true,
              },
            ],
          });
        }

        const missingSupplemental = mockMissingSupplementalCategoryDetail(url);
        if (missingSupplemental) {
          return missingSupplemental;
        }

        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    const result = await fetchVimeoCategories('token');

    expect(result).toEqual({
      ok: true,
      items: [
        {
          uri: '/categories/brandedcontent',
          name: 'Branded Content',
          subcategories: [{ uri: '/categories/brandedcontent/brandeddoc', name: 'Documentary' }],
          mayHaveSubcategories: true,
        },
      ],
    });
  });
});

describe('fetchVimeoCategorySubcategories', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches subcategories from the category detail endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/categories/brandedcontent') && !url.includes('/categories?')) {
          expect(url).not.toContain('fields=');
          return Response.json({
            uri: '/categories/brandedcontent',
            name: 'Branded Content',
            subcategories: [
              {
                uri: '/categories/brandedcontent/brandeddoc',
                name: 'Documentary',
              },
            ],
          });
        }

        if (url.includes('/categories?')) {
          return Response.json({
            data: [{ uri: '/categories/brandedcontent', name: 'Branded Content', top_level: true }],
          });
        }

        const missingSupplemental = mockMissingSupplementalCategoryDetail(url);
        if (missingSupplemental) {
          return missingSupplemental;
        }

        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    const result = await fetchVimeoCategorySubcategories('brandedcontent', 'token');

    expect(result).toEqual({
      ok: true,
      items: [
        {
          uri: '/categories/brandedcontent/brandeddoc',
          name: 'Documentary',
        },
      ],
    });
  });

  it('falls back to the dedicated subcategories collection when detail omits children', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/categories/brandedcontent/subcategories')) {
          return Response.json({
            data: [
              {
                uri: '/categories/brandedcontent/brandeddoc',
                name: 'Documentary',
                top_level: false,
              },
            ],
          });
        }

        if (url.includes('/categories/brandedcontent') && !url.includes('/categories?')) {
          return Response.json({
            uri: '/categories/brandedcontent',
            name: 'Branded Content',
          });
        }

        if (url.includes('/categories?')) {
          return Response.json({
            data: [{ uri: '/categories/brandedcontent', name: 'Branded Content', top_level: true }],
          });
        }

        const missingSupplemental = mockMissingSupplementalCategoryDetail(url);
        if (missingSupplemental) {
          return missingSupplemental;
        }

        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    const result = await fetchVimeoCategorySubcategories('brandedcontent', 'token');

    expect(result).toEqual({
      ok: true,
      items: [{ uri: '/categories/brandedcontent/brandeddoc', name: 'Documentary' }],
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

        return Response.json({
          account: 'plus',
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
        membershipType: 'plus',
        supportsUnlistedPrivacy: false,
      },
    });
  });

  it('requests membership fields on GET /me', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/contentratings')) {
          return mockContentRatingsResponse();
        }
        expect(url).toContain('/me');
        expect(url).toContain(
          'fields=account%2Cmembership.type%2Cmembership.display%2Cpreferences.videos.license%2Cpreferences.videos.rating'
        );

        return Response.json({
          account: 'basic',
          preferences: {
            videos: {
              rating: ['safe'],
            },
          },
        });
      })
    );

    await fetchVimeoAccountDefaults('token');
  });

  it('reads membership.type from /me and resolves unlisted support', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/contentratings')) {
          return mockContentRatingsResponse();
        }

        return Response.json({
          membership: { type: 'free' },
          preferences: {
            videos: {
              rating: ['safe'],
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
        membershipType: 'free',
        supportsUnlistedPrivacy: false,
      },
    });
  });

  it('falls back to a broader /me fields request when membership.type is omitted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/contentratings')) {
          return mockContentRatingsResponse();
        }
        if (url.includes('membership.type')) {
          return Response.json({
            preferences: {
              videos: {
                rating: ['safe'],
              },
            },
          });
        }
        if (url.includes('fields=account%2Cmembership%2C')) {
          return Response.json({
            account: 'basic',
            preferences: {
              videos: {
                rating: ['safe'],
              },
            },
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    const result = await fetchVimeoAccountDefaults('token');

    expect(result).toEqual({
      ok: true,
      defaults: {
        contentRating: ['safe'],
        membershipType: 'basic',
        supportsUnlistedPrivacy: false,
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
          account: 'plus',
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
        membershipType: 'plus',
        supportsUnlistedPrivacy: false,
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
          account: 'plus',
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
        membershipType: 'plus',
        supportsUnlistedPrivacy: false,
      },
    });
  });

  it('reuses pre-fetched content ratings without calling /contentratings again', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        expect(url).toContain('/me');
        expect(url).not.toContain('/contentratings');

        return Response.json({
          account: 'basic',
          preferences: {
            videos: {
              rating: ['safe'],
              license: 'by-sa',
            },
          },
        });
      })
    );

    const result = await fetchVimeoAccountDefaults('token', undefined, [
      { code: 'safe', name: 'All audiences' },
    ]);

    const mockFetch = vi.mocked(global.fetch);
    expect(mockFetch).toHaveBeenCalled();
    expect(fetchCallCountForUrl(mockFetch, '/me')).toBe(1);
    expect(fetchCallCountForUrl(mockFetch, '/contentratings')).toBe(0);
    expect(result).toEqual({
      ok: true,
      defaults: {
        contentRating: ['safe'],
        license: 'by-sa',
        membershipType: 'basic',
        supportsUnlistedPrivacy: false,
      },
    });
  });
});

describe('fetchVimeoDraftMetadataOptions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches each upstream resource once and resolves account defaults', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const missingSupplemental = mockMissingSupplementalCategoryDetail(url);
        if (missingSupplemental) {
          return missingSupplemental;
        }

        if (url.includes('/contentratings')) {
          return mockContentRatingsResponse();
        }
        if (url.includes('/categories?')) {
          return Response.json({
            data: [
              {
                uri: '/categories/music',
                name: 'Music',
                top_level: true,
                subcategories: [
                  { uri: '/categories/music/subcategories/videos', name: 'Music Videos' },
                ],
              },
            ],
          });
        }
        if (url.includes('/creativecommons')) {
          return Response.json({
            data: [
              { code: 'by-nc', name: 'Attribution Non-Commercial', uri: '/creativecommons/by-nc' },
            ],
          });
        }
        expect(url).toContain('/me');
        return Response.json({
          account: 'basic',
          preferences: {
            videos: {
              rating: ['safe'],
              license: null,
            },
          },
        });
      })
    );

    const result = await fetchVimeoDraftMetadataOptions('token');

    const mockFetch = vi.mocked(global.fetch);
    expect(mockFetch).toHaveBeenCalled();
    expect(fetchCallCountForUrl(mockFetch, '/contentratings')).toBe(1);
    expect(fetchCallCountForUrl(mockFetch, '/creativecommons')).toBe(1);
    expect(fetchCallCountForUrl(mockFetch, '/categories?')).toBe(1);
    expect(fetchCallCountForUrl(mockFetch, '/me')).toBe(1);
    expect(result).toEqual({
      ok: true,
      options: {
        contentRatings: SAMPLE_CONTENT_RATINGS.data,
        categories: [
          {
            uri: '/categories/music',
            name: 'Music',
            mayHaveSubcategories: true,
            subcategories: [
              { uri: '/categories/music/subcategories/videos', name: 'Music Videos' },
            ],
          },
        ],
        licenses: [{ code: 'by-nc', name: 'Attribution Non-Commercial' }],
        accountDefaults: {
          contentRating: ['safe'],
          license: null,
          membershipType: 'basic',
          supportsUnlistedPrivacy: false,
        },
      },
    });
  });
});
