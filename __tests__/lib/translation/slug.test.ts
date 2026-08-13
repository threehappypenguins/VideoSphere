import { describe, expect, it } from 'vitest';
import {
  getTranslationSlugValidationError,
  normalizeTranslationSlug,
  suggestTranslationSlug,
} from '@/lib/translation/slug';

describe('translation slug helpers', () => {
  it('normalizes to lowercase trimmed form', () => {
    expect(normalizeTranslationSlug('  Sarah-Poulin  ')).toBe('sarah-poulin');
  });

  it('suggests a slug from a display name without a random suffix', () => {
    expect(suggestTranslationSlug('Sarah Poulin')).toBe('sarah-poulin');
  });

  it('appends a numeric disambiguator when requested', () => {
    expect(suggestTranslationSlug('Sarah Poulin', 2)).toBe('sarah-poulin-2');
  });

  it('falls back to listen when the seed is too short', () => {
    expect(suggestTranslationSlug('ab')).toBe('listen');
  });

  it('rejects invalid slugs', () => {
    expect(getTranslationSlugValidationError('ab')).toMatch(/between/i);
    expect(getTranslationSlugValidationError('Sarah')).toMatch(/lowercase/i);
  });
});
