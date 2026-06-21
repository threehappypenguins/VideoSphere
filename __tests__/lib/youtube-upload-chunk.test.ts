import { describe, it, expect } from 'vitest';
import {
  estimateYouTubeTagsListCharCount,
  nextYouTubeChunkSize,
  normalizeYouTubeSnippetTags,
  parseYouTube308RangeLastByteInclusive,
} from '@/lib/platforms/youtube';

describe('normalizeYouTubeSnippetTags', () => {
  it('trims tags, removes whitespace-only entries, and drops single-character tags', () => {
    expect(normalizeYouTubeSnippetTags(['  a  ', ' b', '\t', ''])).toEqual([]);
    expect(normalizeYouTubeSnippetTags(['  ab  ', ' cd', '\t', ''])).toEqual(['ab', 'cd']);
  });

  it('matches YouTube docs: spaced tag counts as quoted (+2) for length', () => {
    expect(estimateYouTubeTagsListCharCount(['Foo-Baz'])).toBe(7);
    expect(estimateYouTubeTagsListCharCount(['Foo Baz'])).toBe(9);
  });

  it('drops trailing tags when the serialized list would exceed 500 characters', () => {
    const many = Array.from({ length: 200 }, (_, i) => `t${i}`);
    const out = normalizeYouTubeSnippetTags(many);
    expect(out.length).toBeLessThan(many.length);
    expect(estimateYouTubeTagsListCharCount(out)).toBeLessThanOrEqual(500);
  });

  it('truncates an oversized first tag so the upload still gets keywords', () => {
    const long = 'x'.repeat(600);
    const out = normalizeYouTubeSnippetTags([long]);
    expect(out.length).toBe(1);
    expect(estimateYouTubeTagsListCharCount(out)).toBeLessThanOrEqual(500);
  });
});

describe('parseYouTube308RangeLastByteInclusive', () => {
  it('parses bytes=start-end and bytes start-end', () => {
    expect(parseYouTube308RangeLastByteInclusive('bytes=0-524287')).toBe(524287);
    expect(parseYouTube308RangeLastByteInclusive('bytes 0-524287')).toBe(524287);
    expect(parseYouTube308RangeLastByteInclusive('BYTES=0-42')).toBe(42);
  });

  it('returns null for missing, empty, or malformed values', () => {
    expect(parseYouTube308RangeLastByteInclusive(null)).toBeNull();
    expect(parseYouTube308RangeLastByteInclusive('')).toBeNull();
    expect(parseYouTube308RangeLastByteInclusive('   ')).toBeNull();
    expect(parseYouTube308RangeLastByteInclusive('bytes */524287')).toBeNull();
    expect(parseYouTube308RangeLastByteInclusive('bytes=0-')).toBeNull();
    expect(parseYouTube308RangeLastByteInclusive('range 0-10')).toBeNull();
    expect(parseYouTube308RangeLastByteInclusive('bytes=5-3')).toBeNull();
  });
});

describe('nextYouTubeChunkSize', () => {
  it('returns remaining when smaller than 256 KiB (last chunk)', () => {
    expect(nextYouTubeChunkSize(100)).toBe(100);
    expect(nextYouTubeChunkSize(256 * 1024 - 1)).toBe(256 * 1024 - 1);
  });

  it('aligns to 256 KiB multiples up to 8 MiB target', () => {
    expect(nextYouTubeChunkSize(256 * 1024)).toBe(256 * 1024);
    expect(nextYouTubeChunkSize(8 * 1024 * 1024)).toBe(8 * 1024 * 1024);
    expect(nextYouTubeChunkSize(8 * 1024 * 1024 + 100)).toBe(8 * 1024 * 1024);
  });
});
