import { describe, expect, it } from 'vitest';
import {
  buildYouTubeAccountDefaultsSeedPatch,
  resolveYouTubeOptionalFieldValue,
} from '@/lib/platforms/youtube-account-defaults';
import type { YouTubeDraftFields } from '@/types';

describe('buildYouTubeAccountDefaultsSeedPatch', () => {
  const defaults = {
    defaultAudioLanguage: 'en',
    madeForKids: true,
    categoryId: '22',
    license: 'creativeCommon' as const,
    embeddable: false,
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
    });
  });

  it('returns an empty patch when every default field is already set', () => {
    const draft: YouTubeDraftFields = {
      defaultAudioLanguage: 'de',
      madeForKids: false,
      categoryId: '10',
      license: 'youtube',
      embeddable: true,
    };

    expect(buildYouTubeAccountDefaultsSeedPatch(draft, defaults)).toEqual({});
  });

  it('does not seed defaultAudioLanguage when the user explicitly cleared it', () => {
    const draft: YouTubeDraftFields = {
      defaultAudioLanguage: null,
    };

    expect(buildYouTubeAccountDefaultsSeedPatch(draft, defaults)).toEqual({
      madeForKids: true,
      categoryId: '22',
      license: 'creativeCommon',
      embeddable: false,
    });
  });
});

describe('resolveYouTubeOptionalFieldValue', () => {
  it('falls back to account defaults when the field is absent', () => {
    expect(resolveYouTubeOptionalFieldValue(undefined, 'defaultAudioLanguage', 'en')).toBe('en');
  });

  it('returns undefined when the field was explicitly cleared', () => {
    expect(
      resolveYouTubeOptionalFieldValue({ defaultAudioLanguage: null }, 'defaultAudioLanguage', 'en')
    ).toBeUndefined();
  });

  it('trims stored values and treats whitespace-only strings as unset', () => {
    expect(
      resolveYouTubeOptionalFieldValue(
        { defaultAudioLanguage: '  en  ' },
        'defaultAudioLanguage',
        'de'
      )
    ).toBe('en');
    expect(
      resolveYouTubeOptionalFieldValue(
        { defaultAudioLanguage: '   ' },
        'defaultAudioLanguage',
        'en'
      )
    ).toBeUndefined();
  });

  it('trims account default fallbacks', () => {
    expect(resolveYouTubeOptionalFieldValue(undefined, 'categoryId', '  22  ')).toBe('22');
  });
});
