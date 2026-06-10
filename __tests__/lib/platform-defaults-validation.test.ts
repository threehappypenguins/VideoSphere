import { describe, expect, it } from 'vitest';

import { normalizeStoredPlatformDefaults } from '@/lib/auth/platform-defaults-validation';

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
