import { describe, expect, it } from 'vitest';
import { buildYouTubeAccountDefaultsSeedPatch } from '@/lib/platforms/youtube-account-defaults';
import type { YouTubeDraftFields } from '@/types';

describe('buildYouTubeAccountDefaultsSeedPatch', () => {
  const defaults = {
    defaultAudioLanguage: 'en',
    madeForKids: true,
    categoryId: '22',
    license: 'creativeCommon' as const,
    embeddable: false,
    publicStatsViewable: false,
  };

  it('seeds unset YouTube fields from account defaults', () => {
    expect(buildYouTubeAccountDefaultsSeedPatch(undefined, defaults)).toEqual(defaults);
  });

  it('does not overwrite fields already set on the draft', () => {
    const draft: YouTubeDraftFields = {
      license: 'youtube',
      embeddable: true,
    };

    expect(buildYouTubeAccountDefaultsSeedPatch(draft, defaults)).toEqual({
      defaultAudioLanguage: 'en',
      madeForKids: true,
      categoryId: '22',
      publicStatsViewable: false,
    });
  });

  it('returns an empty patch when every default field is already set', () => {
    const draft: YouTubeDraftFields = {
      defaultAudioLanguage: 'de',
      madeForKids: false,
      categoryId: '10',
      license: 'youtube',
      embeddable: true,
      publicStatsViewable: true,
    };

    expect(buildYouTubeAccountDefaultsSeedPatch(draft, defaults)).toEqual({});
  });
});
