import { describe, expect, it } from 'vitest';

import {
  buildVimeoContentRatingPayload,
  buildVimeoPrimaryTierOptions,
  filterVimeoMatureDetailOptions,
  normalizeVimeoContentRatingCodes,
  parseVimeoContentRatingTier,
  readMeDefaultContentRatingCodes,
  resolveVimeoAccountContentRatingDefault,
  vimeoContentRatingForUpload,
} from '@/lib/platforms/vimeo-content-rating';

const SAMPLE_RATINGS = [
  { code: 'safe', name: 'All audiences' },
  { code: 'violence', name: 'Violence' },
  { code: 'language', name: 'Language' },
  { code: 'unrated', name: 'Not Yet Rated' },
];

describe('filterVimeoMatureDetailOptions', () => {
  it('returns all API rows except safe and unrated for the secondary multi-select', () => {
    expect(filterVimeoMatureDetailOptions(SAMPLE_RATINGS)).toEqual([
      { code: 'violence', name: 'Violence' },
      { code: 'language', name: 'Language' },
    ]);
  });

  it('includes any non-primary code returned by the API, such as advertisement', () => {
    expect(
      filterVimeoMatureDetailOptions([
        ...SAMPLE_RATINGS,
        { code: 'advertisement', name: 'Contains advertisement' },
      ])
    ).toEqual([
      { code: 'violence', name: 'Violence' },
      { code: 'language', name: 'Language' },
      { code: 'advertisement', name: 'Contains advertisement' },
    ]);
  });
});

describe('buildVimeoPrimaryTierOptions', () => {
  it('builds All audiences and Mature options from fetched API rows', () => {
    expect(buildVimeoPrimaryTierOptions(SAMPLE_RATINGS)).toEqual([
      { tier: 'all_audiences', value: 'safe', label: 'All audiences' },
      { tier: 'mature', value: '__vimeo_tier_mature__', label: 'Mature' },
    ]);
  });

  it('does not expose unrated as a primary upload option', () => {
    expect(
      buildVimeoPrimaryTierOptions(SAMPLE_RATINGS).some((option) => option.value === 'unrated')
    ).toBe(false);
  });
});

describe('parseVimeoContentRatingTier', () => {
  it('maps safe codes to All Audiences', () => {
    expect(parseVimeoContentRatingTier(['safe'])).toEqual({
      tier: 'all_audiences',
      matureDetails: [],
    });
  });

  it('maps mature-detail codes to Mature', () => {
    expect(parseVimeoContentRatingTier(['language', 'violence'])).toEqual({
      tier: 'mature',
      matureDetails: ['language', 'violence'],
    });
  });

  it('treats unrated as unset because Vimeo upload UI does not select it', () => {
    expect(parseVimeoContentRatingTier(['unrated'])).toEqual({
      tier: undefined,
      matureDetails: [],
    });
  });

  it('treats an empty array as Mature with no detail flags selected yet', () => {
    expect(parseVimeoContentRatingTier([])).toEqual({
      tier: 'mature',
      matureDetails: [],
    });
  });
});

describe('buildVimeoContentRatingPayload', () => {
  it('builds the correct upload arrays per tier', () => {
    expect(buildVimeoContentRatingPayload('all_audiences', [])).toEqual(['safe']);
    expect(buildVimeoContentRatingPayload('mature', ['language', 'violence'])).toEqual([
      'language',
      'violence',
    ]);
  });
});

describe('normalizeVimeoContentRatingCodes', () => {
  it('normalizes legacy single-string values', () => {
    expect(normalizeVimeoContentRatingCodes('safe')).toEqual(['safe']);
  });

  it('prefers mature-detail codes over safe when both are present', () => {
    expect(normalizeVimeoContentRatingCodes(['safe', 'language'])).toEqual(['language']);
  });

  it('preserves an empty array as the mature-tier placeholder', () => {
    expect(normalizeVimeoContentRatingCodes([])).toEqual([]);
  });
});

describe('vimeoContentRatingForUpload', () => {
  it('wraps audience tiers and mature selections for Vimeo create payloads', () => {
    expect(vimeoContentRatingForUpload(['safe'])).toEqual(['safe']);
    expect(vimeoContentRatingForUpload(['language', 'violence'])).toEqual(['language', 'violence']);
    expect(vimeoContentRatingForUpload(undefined)).toBeUndefined();
    expect(vimeoContentRatingForUpload([])).toBeUndefined();
    expect(vimeoContentRatingForUpload(['unrated'])).toBeUndefined();
  });
});

describe('readMeDefaultContentRatingCodes', () => {
  it('reads upload defaults from preferences.videos.rating on /me', () => {
    expect(
      readMeDefaultContentRatingCodes({
        content_filter: ['language', 'drugs', 'violence', 'nudity', 'safe', 'unrated'],
        preferences: {
          videos: {
            rating: ['safe'],
          },
        },
      })
    ).toEqual(['safe']);
  });

  it('reads mature upload defaults from preferences.videos.rating on /me', () => {
    expect(
      readMeDefaultContentRatingCodes({
        preferences: {
          videos: {
            rating: ['language', 'violence'],
          },
        },
      })
    ).toEqual(['language', 'violence']);
  });

  it('falls back to nested content_rating fields when preferences.rating is absent', () => {
    expect(
      readMeDefaultContentRatingCodes({
        videos: {
          content_rating: ['safe'],
        },
      })
    ).toEqual(['safe']);
  });
});

describe('resolveVimeoAccountContentRatingDefault', () => {
  const apiOptions = SAMPLE_RATINGS;

  it('uses the user upload default when present on /me', () => {
    expect(resolveVimeoAccountContentRatingDefault(['safe'], apiOptions)).toEqual(['safe']);
    expect(resolveVimeoAccountContentRatingDefault(['language', 'violence'], apiOptions)).toEqual([
      'language',
      'violence',
    ]);
  });

  it('ignores user codes that are not returned by /contentratings', () => {
    expect(resolveVimeoAccountContentRatingDefault(['made-up'], apiOptions)).toBeUndefined();
  });

  it('returns undefined when the user has no upload default configured', () => {
    expect(resolveVimeoAccountContentRatingDefault(undefined, apiOptions)).toBeUndefined();
  });
});
