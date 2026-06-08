import { describe, expect, it } from 'vitest';
import {
  formatSermonAudioKeywordsFromTags,
  mergeUniqueTags,
  normalizeTagForStorage,
  parseSermonAudioHashtagInput,
  parseSharedTagInput,
  tagListIncludesEquivalent,
} from '@/lib/platforms/sermon-audio-tags';

describe('normalizeTagForStorage', () => {
  it('trims text and strips leading hash characters', () => {
    expect(normalizeTagForStorage('  #faith  ')).toBe('faith');
    expect(normalizeTagForStorage('##hope')).toBe('hope');
  });
});

describe('parseSharedTagInput', () => {
  it('parses comma-separated tags and keeps internal spaces', () => {
    expect(parseSharedTagInput('this is, #faith')).toEqual(['this is', 'faith']);
  });
});

describe('parseSermonAudioHashtagInput', () => {
  it('parses single-word hashtags from commas and whitespace', () => {
    expect(parseSermonAudioHashtagInput('#faith, hope grace')).toEqual(['faith', 'hope', 'grace']);
  });
});

describe('formatSermonAudioKeywordsFromTags', () => {
  it('removes spaces and hash prefixes for SermonAudio keywords', () => {
    expect(formatSermonAudioKeywordsFromTags(['this is', '#faith', 'hope'])).toBe(
      'thisis, faith, hope'
    );
  });
});

describe('mergeUniqueTags', () => {
  it('deduplicates tags case-insensitively and ignores leading hash', () => {
    expect(mergeUniqueTags(['faith'], ['#Faith', 'hope'])).toEqual(['faith', 'hope']);
    expect(tagListIncludesEquivalent(['faith'], '#Faith')).toBe(true);
  });
});
