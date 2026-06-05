import { describe, expect, it } from 'vitest';
import {
  buildSermonAudioSeriesTitleMap,
  parseRecentSermonAudioSeriesFromSermonsList,
  parseSermonAudioSeries,
  parseSermonAudioSeriesFromListBody,
  parseSermonAudioSeriesFromSearchBody,
} from '@/lib/platforms/sermon-audio-series';

describe('parseSermonAudioSeries', () => {
  it('parses seriesID and title', () => {
    expect(parseSermonAudioSeries({ seriesID: 42, title: 'Romans' })).toEqual({
      seriesID: 42,
      title: 'Romans',
    });
  });

  it('returns null for invalid payloads', () => {
    expect(parseSermonAudioSeries(null)).toBeNull();
    expect(parseSermonAudioSeries({ seriesID: 0, title: 'X' })).toBeNull();
    expect(parseSermonAudioSeries({ seriesID: 1, title: '   ' })).toBeNull();
  });
});

describe('parseRecentSermonAudioSeriesFromSermonsList', () => {
  it('orders series by newest sermon first and deduplicates repeats', () => {
    expect(
      parseRecentSermonAudioSeriesFromSermonsList({
        results: [
          {
            preachDate: '2026-06-01',
            series: { seriesID: 10, title: 'Romans' },
          },
          {
            preachDate: '2026-05-25',
            series: { seriesID: 11, title: 'Genesis' },
          },
          {
            preachDate: '2026-05-18',
            series: { seriesID: 10, title: 'Romans' },
          },
        ],
      })
    ).toEqual([
      { seriesID: 10, title: 'Romans' },
      { seriesID: 11, title: 'Genesis' },
    ]);
  });

  it('uses sermon subtitle when series payload is lite', () => {
    expect(
      parseRecentSermonAudioSeriesFromSermonsList({
        results: [
          {
            subtitle: 'Hebrews',
            series: { seriesID: 12 },
          },
        ],
      })
    ).toEqual([{ seriesID: 12, title: 'Hebrews' }]);
  });
});

describe('parseSermonAudioSeriesFromListBody', () => {
  it('preserves broadcaster series list order', () => {
    expect(
      parseSermonAudioSeriesFromListBody({
        results: [
          { seriesID: 2, title: 'Acts' },
          { seriesID: 1, title: 'John' },
        ],
      })
    ).toEqual([
      { seriesID: 2, title: 'Acts' },
      { seriesID: 1, title: 'John' },
    ]);
  });
});

describe('parseSermonAudioSeriesFromSearchBody', () => {
  it('preserves multisearch series result order', () => {
    expect(
      parseSermonAudioSeriesFromSearchBody({
        seriesResults: [
          { seriesID: 2, title: 'Zephaniah' },
          { seriesID: 1, title: 'Amos' },
        ],
      })
    ).toEqual([
      { seriesID: 2, title: 'Zephaniah' },
      { seriesID: 1, title: 'Amos' },
    ]);
  });
});

describe('buildSermonAudioSeriesTitleMap', () => {
  it('maps series ids to titles', () => {
    const map = buildSermonAudioSeriesTitleMap({
      results: [{ seriesID: 5, title: 'Psalms' }],
    });
    expect(map.get(5)).toBe('Psalms');
  });
});
