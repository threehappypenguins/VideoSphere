import { describe, expect, it } from 'vitest';
import {
  parseRecentSermonAudioSpeakersFromFilterOptions,
  parseRecentSermonAudioSpeakersFromSermonsList,
  parseSermonAudioSpeaker,
  parseSermonAudioSpeakersFromBody,
  parseSermonAudioSpeakersFromSearchBody,
} from '@/lib/platforms/sermon-audio-speakers';

describe('parseSermonAudioSpeaker', () => {
  it('parses speakerID and displayName', () => {
    expect(parseSermonAudioSpeaker({ speakerID: 42, displayName: 'Rev. Smith' })).toEqual({
      speakerID: 42,
      displayName: 'Rev. Smith',
    });
  });

  it('returns null for invalid payloads', () => {
    expect(parseSermonAudioSpeaker(null)).toBeNull();
    expect(parseSermonAudioSpeaker({ speakerID: 0, displayName: 'X' })).toBeNull();
    expect(parseSermonAudioSpeaker({ speakerID: 1, displayName: '   ' })).toBeNull();
  });
});

describe('parseRecentSermonAudioSpeakersFromSermonsList', () => {
  it('orders speakers by newest sermon first and deduplicates repeats', () => {
    expect(
      parseRecentSermonAudioSpeakersFromSermonsList({
        results: [
          {
            preachDate: '2026-06-01',
            speaker: { speakerID: 10, displayName: 'Rev. Smith' },
          },
          {
            preachDate: '2026-05-25',
            speaker: { speakerID: 11, displayName: 'Pastor Jones' },
          },
          {
            preachDate: '2026-05-18',
            speaker: { speakerID: 10, displayName: 'Rev. Smith' },
          },
        ],
      })
    ).toEqual([
      { speakerID: 10, displayName: 'Rev. Smith' },
      { speakerID: 11, displayName: 'Pastor Jones' },
    ]);
  });
});

describe('parseRecentSermonAudioSpeakersFromFilterOptions', () => {
  it('preserves filter_options speaker order', () => {
    expect(
      parseRecentSermonAudioSpeakersFromFilterOptions({
        speakers: [
          { speakerID: 10, displayName: 'Rev. Smith' },
          { speakerID: 11, displayName: 'Pastor Jones' },
        ],
      })
    ).toEqual([
      { speakerID: 10, displayName: 'Rev. Smith' },
      { speakerID: 11, displayName: 'Pastor Jones' },
    ]);
  });
});

describe('parseSermonAudioSpeakersFromSearchBody', () => {
  it('preserves search result order', () => {
    expect(
      parseSermonAudioSpeakersFromSearchBody({
        speakerResults: [
          { speakerID: 2, displayName: 'Zed Brown' },
          { speakerID: 1, displayName: 'Amy Lee' },
        ],
      })
    ).toEqual([
      { speakerID: 2, displayName: 'Zed Brown' },
      { speakerID: 1, displayName: 'Amy Lee' },
    ]);
  });
});

describe('parseSermonAudioSpeakersFromBody', () => {
  it('sorts generic speaker lists alphabetically', () => {
    const speakers = parseSermonAudioSpeakersFromBody({
      results: [
        { speakerID: 2, displayName: 'Zed Brown' },
        { speakerID: 1, displayName: 'Amy Lee' },
      ],
    });
    expect(speakers).toEqual([
      { speakerID: 1, displayName: 'Amy Lee' },
      { speakerID: 2, displayName: 'Zed Brown' },
    ]);
  });
});
