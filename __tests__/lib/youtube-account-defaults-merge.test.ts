import { describe, expect, it } from 'vitest';

import { mergeYouTubeAccountDefaults } from '@/lib/platforms/youtube-account-defaults';

describe('mergeYouTubeAccountDefaults', () => {
  it('overrides YouTube-inferred defaults with saved profile defaults', () => {
    expect(
      mergeYouTubeAccountDefaults(
        {
          defaultAudioLanguage: 'fr',
          categoryId: '24',
          license: 'creativeCommon',
          embeddable: false,
        },
        {
          defaultAudioLanguage: 'en',
          categoryId: '22',
          license: 'youtube',
          embeddable: true,
        }
      )
    ).toEqual({
      defaultAudioLanguage: 'en',
      categoryId: '22',
      license: 'youtube',
      embeddable: true,
    });
  });

  it('returns YouTube defaults unchanged when profile defaults are absent', () => {
    const fromYouTube = {
      defaultAudioLanguage: 'en',
      categoryId: '22',
    };

    expect(mergeYouTubeAccountDefaults(fromYouTube, undefined)).toEqual(fromYouTube);
  });
});
