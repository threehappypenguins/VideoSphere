import { describe, expect, it } from 'vitest';
import {
  TRANSLATION_LANGUAGES,
  filterTranslationLanguages,
  isKnownTranslationLanguage,
  normalizeTranslationLanguageCode,
  translationLanguageLabel,
  translationLanguagePublicLabel,
} from '@/lib/translation/languages';

describe('translation languages', () => {
  it('includes suggested-stack defaults (en, es, pt, tl)', () => {
    const codes = TRANSLATION_LANGUAGES.map((l) => l.code);
    expect(codes).toEqual(expect.arrayContaining(['en', 'es', 'pt', 'tl']));
    expect(TRANSLATION_LANGUAGES.find((l) => l.code === 'tl')?.name).toBe('Tagalog');
  });

  it('recognizes curated codes case-insensitively', () => {
    expect(isKnownTranslationLanguage('EN')).toBe(true);
    expect(isKnownTranslationLanguage('es')).toBe(true);
    expect(isKnownTranslationLanguage('xx')).toBe(false);
  });

  it('labels curated codes and falls back to raw unknown codes', () => {
    expect(translationLanguageLabel('es')).toBe('Spanish');
    expect(translationLanguageLabel('legacy-code')).toBe('legacy-code');
  });

  it('builds public labels with native autonyms in their own script', () => {
    expect(translationLanguagePublicLabel('fr')).toBe('French (Français)');
    expect(translationLanguagePublicLabel('zh')).toBe('Chinese (中文)');
    expect(translationLanguagePublicLabel('ja')).toBe('Japanese (日本語)');
    expect(translationLanguagePublicLabel('ar')).toBe('Arabic (العربية)');
    expect(translationLanguagePublicLabel('en')).toBe('English');
    expect(translationLanguagePublicLabel('tl')).toBe('Tagalog');
  });

  it('filters languages by English name, native name, or code', () => {
    const hits = filterTranslationLanguages(TRANSLATION_LANGUAGES, 'franc');
    expect(hits.map((l) => l.code)).toEqual(['fr']);
    expect(filterTranslationLanguages(TRANSLATION_LANGUAGES, '中文').map((l) => l.code)).toEqual([
      'zh',
    ]);
    expect(filterTranslationLanguages(TRANSLATION_LANGUAGES, 'tl').map((l) => l.code)).toEqual([
      'tl',
    ]);
  });

  it('normalizes codes for storage comparison', () => {
    expect(normalizeTranslationLanguageCode('  ES ')).toBe('es');
  });
});