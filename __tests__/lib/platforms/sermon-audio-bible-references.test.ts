import { describe, expect, it } from 'vitest';
import { SERMON_AUDIO_BIBLE_BOOKS } from '@/lib/platforms/sermon-audio-bible-books';
import {
  addBibleReference,
  formatChapterRangeReference,
  formatChapterRangeEndingVerseReference,
  formatChapterReference,
  formatSingleVerseReference,
  formatVerseRangeReference,
  getChapterVerseCount,
  parseBibleReferences,
  removeBibleReference,
  serializeBibleReferences,
  validateAndNormalizeTypedBibleReference,
} from '@/lib/platforms/sermon-audio-bible-references';

describe('parseBibleReferences', () => {
  it('splits semicolon-separated SA bibleText values', () => {
    expect(parseBibleReferences('Genesis 1:1; John 3:16')).toEqual(['Genesis 1:1', 'John 3:16']);
  });

  it('limits to two references', () => {
    expect(parseBibleReferences('Genesis 1; Exodus 1; Leviticus 1')).toEqual([
      'Genesis 1',
      'Exodus 1',
    ]);
  });
});

describe('serializeBibleReferences', () => {
  it('joins references with semicolons', () => {
    expect(serializeBibleReferences(['Genesis 1:1', 'John 3:16'])).toBe('Genesis 1:1; John 3:16');
  });
});

describe('reference formatting', () => {
  it('formats single verse, verse range, chapter, and chapter range references', () => {
    expect(formatSingleVerseReference('Genesis', 1, 1)).toBe('Genesis 1:1');
    expect(formatVerseRangeReference('Genesis', 1, 1, 1, 5)).toBe('Genesis 1:1-5');
    expect(formatVerseRangeReference('Genesis', 1, 1, 2, 3)).toBe('Genesis 1:1-2:3');
    expect(formatChapterReference('Genesis', 1)).toBe('Genesis 1');
    expect(formatChapterRangeReference('Genesis', 1, 3)).toBe('Genesis 1-3');
    expect(formatChapterRangeEndingVerseReference('Genesis', 1, 2, 5)).toBe('Genesis 1:1-2:5');
    expect(formatChapterRangeEndingVerseReference('Genesis', 1, 3, 3)).toBe('Genesis 1:1-3:3');
  });
});

describe('addBibleReference', () => {
  it('adds up to two unique references', () => {
    expect(addBibleReference([], 'Genesis 1:1')).toEqual(['Genesis 1:1']);
    expect(addBibleReference(['Genesis 1:1'], 'John 3:16')).toEqual(['Genesis 1:1', 'John 3:16']);
    expect(addBibleReference(['Genesis 1:1', 'John 3:16'], 'Psalms 23')).toEqual([
      'Genesis 1:1',
      'John 3:16',
    ]);
    expect(addBibleReference(['Genesis 1:1'], 'genesis 1:1')).toEqual(['Genesis 1:1']);
  });
});

describe('removeBibleReference', () => {
  it('removes an exact reference', () => {
    expect(removeBibleReference(['Genesis 1:1', 'John 3:16'], 'Genesis 1:1')).toEqual([
      'John 3:16',
    ]);
  });
});

describe('validateAndNormalizeTypedBibleReference', () => {
  it('normalizes glued and spaced chapter references', () => {
    expect(validateAndNormalizeTypedBibleReference('Genesis1')).toEqual({
      ok: true,
      reference: 'Genesis 1',
    });
    expect(validateAndNormalizeTypedBibleReference('genesis 1')).toEqual({
      ok: true,
      reference: 'Genesis 1',
    });
    expect(validateAndNormalizeTypedBibleReference('John3:16')).toEqual({
      ok: true,
      reference: 'John 3:16',
    });
  });

  it('rejects references with invalid chapter or verse numbers', () => {
    expect(validateAndNormalizeTypedBibleReference('genesis500')).toEqual({
      ok: false,
      input: 'genesis500',
    });
    expect(validateAndNormalizeTypedBibleReference('Genesis 1:500')).toEqual({
      ok: false,
      input: 'Genesis 1:500',
    });
  });

  it('accepts chapter and verse ranges', () => {
    expect(validateAndNormalizeTypedBibleReference('Genesis 1-3')).toEqual({
      ok: true,
      reference: 'Genesis 1-3',
    });
    expect(validateAndNormalizeTypedBibleReference('Genesis1:1-5')).toEqual({
      ok: true,
      reference: 'Genesis 1:1-5',
    });
    expect(validateAndNormalizeTypedBibleReference('Genesis 1:1-2:3')).toEqual({
      ok: true,
      reference: 'Genesis 1:1-2:3',
    });
    expect(validateAndNormalizeTypedBibleReference('Genesis 1-2:5')).toEqual({
      ok: true,
      reference: 'Genesis 1:1-2:5',
    });
  });

  it('normalizes OSIS and Paratext book abbreviations', () => {
    expect(validateAndNormalizeTypedBibleReference('deu 5')).toEqual({
      ok: true,
      reference: 'Deuteronomy 5',
    });
    expect(validateAndNormalizeTypedBibleReference('Deut 5')).toEqual({
      ok: true,
      reference: 'Deuteronomy 5',
    });
    expect(validateAndNormalizeTypedBibleReference('Deut5')).toEqual({
      ok: true,
      reference: 'Deuteronomy 5',
    });
    expect(validateAndNormalizeTypedBibleReference('gen 1:1')).toEqual({
      ok: true,
      reference: 'Genesis 1:1',
    });
    expect(validateAndNormalizeTypedBibleReference('1Cor 13:4')).toEqual({
      ok: true,
      reference: '1 Corinthians 13:4',
    });
    expect(validateAndNormalizeTypedBibleReference('REV 22')).toEqual({
      ok: true,
      reference: 'Revelation 22',
    });
  });
});

describe('getChapterVerseCount', () => {
  it('returns verse counts from embedded bible structure', () => {
    const genesis = SERMON_AUDIO_BIBLE_BOOKS[0];
    expect(genesis?.displayName).toBe('Genesis');
    expect(getChapterVerseCount(genesis!, 1)).toBe(31);
    expect(getChapterVerseCount(genesis!, 999)).toBe(0);
  });
});
