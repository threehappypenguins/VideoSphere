import { describe, expect, it } from 'vitest';

import {
  normalizeStoredPlatformDefaults,
  parseYouTubeUserDefaults,
} from '@/lib/auth/platform-defaults-validation';

describe('parseYouTubeUserDefaults', () => {
  it('trims defaultAudioLanguage and categoryId', () => {
    expect(
      parseYouTubeUserDefaults({
        defaultAudioLanguage: ' en ',
        categoryId: ' 22 ',
      })
    ).toEqual({
      ok: true,
      value: {
        defaultAudioLanguage: 'en',
        categoryId: '22',
      },
    });
  });

  it('rejects empty or whitespace-only defaultAudioLanguage', () => {
    expect(parseYouTubeUserDefaults({ defaultAudioLanguage: '' })).toEqual({
      ok: false,
      error: 'platformDefaults.youtube.defaultAudioLanguage cannot be empty.',
    });
    expect(parseYouTubeUserDefaults({ defaultAudioLanguage: '   ' })).toEqual({
      ok: false,
      error: 'platformDefaults.youtube.defaultAudioLanguage cannot be empty.',
    });
  });

  it('rejects empty or whitespace-only categoryId', () => {
    expect(parseYouTubeUserDefaults({ categoryId: '' })).toEqual({
      ok: false,
      error: 'platformDefaults.youtube.categoryId cannot be empty.',
    });
    expect(parseYouTubeUserDefaults({ categoryId: '   ' })).toEqual({
      ok: false,
      error: 'platformDefaults.youtube.categoryId cannot be empty.',
    });
  });
});

describe('normalizeStoredPlatformDefaults', () => {
  it('returns undefined for missing, null, or non-object values', () => {
    expect(normalizeStoredPlatformDefaults(undefined)).toBeUndefined();
    expect(normalizeStoredPlatformDefaults(null)).toBeUndefined();
    expect(normalizeStoredPlatformDefaults('nope')).toBeUndefined();
  });

  it('returns undefined for an empty object (Mongoose default)', () => {
    expect(normalizeStoredPlatformDefaults({})).toBeUndefined();
  });

  it('returns undefined when youtube is empty or has no valid fields', () => {
    expect(normalizeStoredPlatformDefaults({ youtube: {} })).toBeUndefined();
    expect(
      normalizeStoredPlatformDefaults({
        youtube: { categoryId: 22, license: 'invalid', extra: true },
      })
    ).toBeUndefined();
  });

  it('drops unknown keys and invalid types, keeping valid youtube fields', () => {
    expect(
      normalizeStoredPlatformDefaults({
        vimeo: { categoryId: 'bad' },
        youtube: {
          categoryId: '22',
          madeForKids: false,
          license: 'youtube',
          embeddable: true,
          defaultAudioLanguage: ' en ',
          publicStatsViewable: true,
          categoryIdBad: 99,
        },
      })
    ).toEqual({
      youtube: {
        categoryId: '22',
        madeForKids: false,
        license: 'youtube',
        embeddable: true,
        defaultAudioLanguage: 'en',
      },
    });
  });
});
