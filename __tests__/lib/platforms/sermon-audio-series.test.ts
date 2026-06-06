import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSermonAudioSeriesTitleMap,
  fetchRecentSermonAudioSeries,
  parseRecentSermonAudioSeriesFromSermonsList,
  parseSermonAudioSeries,
  parseSermonAudioSeriesFromListBody,
  parseSermonAudioSeriesFromSearchBody,
  searchSermonAudioSeries,
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

  it('returns seriesID with empty title when series is lite and subtitle is missing', () => {
    expect(
      parseRecentSermonAudioSeriesFromSermonsList({
        results: [{ series: { seriesID: 12 } }],
      })
    ).toEqual([{ seriesID: 12, title: '' }]);
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

describe('fetchRecentSermonAudioSeries', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws when SermonAudio returns a non-OK response', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    await expect(fetchRecentSermonAudioSeries('key', 'broadcaster-1')).rejects.toThrow(
      /Failed to fetch recent SermonAudio series \(HTTP 401\)/
    );
  });
});

describe('searchSermonAudioSeries', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws when SermonAudio returns a non-OK response', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response('Server error', { status: 503 }));

    await expect(searchSermonAudioSeries('key', 'broadcaster-1', 'romans')).rejects.toThrow(
      /Failed to search SermonAudio series \(HTTP 503\)/
    );
  });
});
