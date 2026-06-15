import { describe, expect, it } from 'vitest';
import {
  buildVimeoAccountDefaultsSeedPatch,
  readMeDefaultLicense,
} from '@/lib/platforms/vimeo-account-defaults';
import type { VimeoDraftFields } from '@/types';

describe('readMeDefaultLicense', () => {
  it('reads upload default license from preferences.videos.license on /me', () => {
    expect(
      readMeDefaultLicense({
        preferences: {
          videos: {
            license: 'by-nc-sa',
          },
        },
      })
    ).toBe('by-nc-sa');
  });

  it('returns null when the user default has no Creative Commons license', () => {
    expect(
      readMeDefaultLicense({
        preferences: {
          videos: {
            license: null,
          },
        },
      })
    ).toBeNull();
  });

  it('ignores top-level license on /me', () => {
    expect(
      readMeDefaultLicense({
        license: 'by-sa',
        preferences: {
          videos: {
            rating: ['safe'],
          },
        },
      })
    ).toBeUndefined();
  });
});

describe('buildVimeoAccountDefaultsSeedPatch', () => {
  const defaults = {
    contentRating: ['safe'],
    license: 'by-nc' as const,
  };

  it('seeds unset Vimeo fields from account defaults', () => {
    expect(buildVimeoAccountDefaultsSeedPatch(undefined, defaults)).toEqual(defaults);
  });

  it('seeds license null when account default has no Creative Commons license', () => {
    expect(buildVimeoAccountDefaultsSeedPatch(undefined, { license: null })).toEqual({
      license: null,
    });
  });

  it('does not overwrite fields already set on the draft', () => {
    const draft: VimeoDraftFields = {
      license: 'cc0',
      contentRating: ['language'],
    };

    expect(buildVimeoAccountDefaultsSeedPatch(draft, defaults)).toEqual({});
  });

  it('returns an empty patch when every default field is already set', () => {
    const draft: VimeoDraftFields = {
      contentRating: ['safe'],
      license: null,
    };

    expect(
      buildVimeoAccountDefaultsSeedPatch(draft, {
        contentRating: ['safe'],
        license: null,
      })
    ).toEqual({});
  });
});
