import { describe, expect, it } from 'vitest';
import {
  buildYouTubeWatchUrl,
  extractYouTubeVideoId,
  isYouTubeImportableCompletedBroadcast,
  mapYouTubeImportResolvedSource,
  parseIso8601DurationToSeconds,
} from '@/lib/youtube-import/resolve-source';

describe('extractYouTubeVideoId', () => {
  it('parses youtube.com/watch URLs', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'dQw4w9WgXcQ'
    );
    expect(extractYouTubeVideoId('https://youtube.com/watch?v=dQw4w9WgXcQ&t=120')).toBe(
      'dQw4w9WgXcQ'
    );
  });

  it('parses youtu.be short URLs', () => {
    expect(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses youtube.com/live URLs', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('accepts bare 11-character video ids', () => {
    expect(extractYouTubeVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for garbage input', () => {
    expect(extractYouTubeVideoId('')).toBeNull();
    expect(extractYouTubeVideoId('not-a-url')).toBeNull();
    expect(extractYouTubeVideoId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(extractYouTubeVideoId('https://youtu.be/short')).toBeNull();
  });
});

describe('buildYouTubeWatchUrl', () => {
  it('builds a canonical watch URL', () => {
    expect(buildYouTubeWatchUrl('dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });
});

describe('parseIso8601DurationToSeconds', () => {
  it('parses hour/minute/second durations', () => {
    expect(parseIso8601DurationToSeconds('PT1H2M3S')).toBe(3723);
    expect(parseIso8601DurationToSeconds('PT15M')).toBe(900);
    expect(parseIso8601DurationToSeconds('PT0S')).toBe(0);
  });

  it('returns null for invalid durations', () => {
    expect(parseIso8601DurationToSeconds('')).toBeNull();
    expect(parseIso8601DurationToSeconds('P1D')).toBeNull();
  });
});

describe('isYouTubeImportableCompletedBroadcast', () => {
  it('accepts completed live archives', () => {
    expect(
      isYouTubeImportableCompletedBroadcast({
        snippet: { liveBroadcastContent: 'none' },
        liveStreamingDetails: {
          actualStartTime: '2026-01-01T00:00:00Z',
          actualEndTime: '2026-01-01T01:00:00Z',
        },
      })
    ).toBe(true);
  });

  it('rejects upcoming and in-progress live broadcasts', () => {
    expect(
      isYouTubeImportableCompletedBroadcast({
        snippet: { liveBroadcastContent: 'upcoming' },
      })
    ).toBe(false);

    expect(
      isYouTubeImportableCompletedBroadcast({
        snippet: { liveBroadcastContent: 'live' },
        liveStreamingDetails: { actualStartTime: '2026-01-01T00:00:00Z' },
      })
    ).toBe(false);
  });
});

describe('mapYouTubeImportResolvedSource', () => {
  const completedVideo = {
    id: 'dQw4w9WgXcQ',
    snippet: {
      title: 'Sunday Service',
      liveBroadcastContent: 'none',
      thumbnails: {
        high: { url: 'https://img.youtube.com/high.jpg' },
      },
    },
    contentDetails: { duration: 'PT1H' },
    liveStreamingDetails: {
      actualStartTime: '2026-01-01T00:00:00Z',
      actualEndTime: '2026-01-01T01:00:00Z',
    },
  };

  it('maps a completed broadcast into import metadata', () => {
    const result = mapYouTubeImportResolvedSource(completedVideo);

    expect(result).toEqual({
      ok: true,
      data: {
        youtubeVideoId: 'dQw4w9WgXcQ',
        title: 'Sunday Service',
        durationSeconds: 3600,
        thumbnailUrl: 'https://img.youtube.com/high.jpg',
      },
    });
  });

  it('rejects videos longer than the configured max duration', () => {
    const previous = process.env.YT_IMPORT_MAX_DURATION_SECONDS;
    process.env.YT_IMPORT_MAX_DURATION_SECONDS = '60';

    const result = mapYouTubeImportResolvedSource(completedVideo);

    expect(result).toEqual({
      ok: false,
      message: 'Video exceeds the maximum import length of 60 seconds.',
    });

    if (previous == null) {
      delete process.env.YT_IMPORT_MAX_DURATION_SECONDS;
    } else {
      process.env.YT_IMPORT_MAX_DURATION_SECONDS = previous;
    }
  });
});
