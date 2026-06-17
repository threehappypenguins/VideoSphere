import { describe, expect, it } from 'vitest';
import {
  parseSermonAudioLanguage,
  parseSermonAudioLanguagesFromListBody,
  SERMON_AUDIO_DEFAULT_LANGUAGE_CODE,
  sortSermonAudioLanguageOptions,
} from '@/lib/platforms/sermon-audio-languages';

describe('parseSermonAudioLanguage', () => {
  it('prefers localizedName over languageName', () => {
    expect(
      parseSermonAudioLanguage({
        languageCode: 'es',
        languageName: 'Spanish',
        localizedName: 'Español',
      })
    ).toEqual({ code: 'es', name: 'Español' });
  });

  it('falls back to languageName then code', () => {
    expect(
      parseSermonAudioLanguage({
        languageCode: 'de',
        languageName: 'German',
        localizedName: null,
      })
    ).toEqual({ code: 'de', name: 'German' });

    expect(parseSermonAudioLanguage({ languageCode: 'fr' })).toEqual({
      code: 'fr',
      name: 'fr',
    });
  });

  it('returns null for invalid payloads', () => {
    expect(parseSermonAudioLanguage(null)).toBeNull();
    expect(parseSermonAudioLanguage({ languageCode: '  ' })).toBeNull();
  });
});

describe('parseSermonAudioLanguagesFromListBody', () => {
  it('parses and deduplicates results', () => {
    expect(
      parseSermonAudioLanguagesFromListBody({
        results: [
          { languageCode: 'en', languageName: 'English', localizedName: 'English' },
          { languageCode: 'en', languageName: 'English duplicate' },
          { languageCode: 'es', languageName: 'Spanish', localizedName: 'Español' },
        ],
      })
    ).toEqual([
      { code: 'en', name: 'English' },
      { code: 'es', name: 'Español' },
    ]);
  });
});

describe('sortSermonAudioLanguageOptions', () => {
  it('places English first then sorts by display name', () => {
    expect(
      sortSermonAudioLanguageOptions([
        { code: 'de', name: 'German' },
        { code: 'en', name: 'English' },
        { code: 'fr', name: 'French' },
      ])
    ).toEqual([
      { code: 'en', name: 'English' },
      { code: 'fr', name: 'French' },
      { code: 'de', name: 'German' },
    ]);
  });

  it('exports the documented default language code', () => {
    expect(SERMON_AUDIO_DEFAULT_LANGUAGE_CODE).toBe('en');
  });
});
