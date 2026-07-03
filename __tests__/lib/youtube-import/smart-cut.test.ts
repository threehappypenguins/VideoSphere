import { describe, expect, it } from 'vitest';
import {
  buildSmartCutEncodeFilterGraph,
  buildSmartCutFilteredVideoEncodeArgs,
  buildSmartCutFullEncodeFfmpegArgs,
  buildSmartCutSegmentFfmpegArgs,
  findNextKeyframeAfter,
  findPrevKeyframeAtOrBefore,
  formatFpsFilterValue,
  isOnKeyframe,
  normalizeStandardFrameRate,
  parseAudioSampleRate,
  parseVideoFrameRate,
  planSmartCutSegments,
  resolveSmartCutFrameRate,
  resolveSmartCutFrameRateRational,
  resolveSmartCutSegmentTrimBounds,
  shouldUseFullFilterEncode,
} from '@/lib/youtube-import/smart-cut';

describe('planSmartCutSegments', () => {
  const keyframes = [0, 10, 20, 30, 40, 50];

  it('stream-copies when both boundaries are on keyframes', () => {
    expect(planSmartCutSegments(10, 30, keyframes)).toEqual([
      { mode: 'copy', startSeconds: 10, endSeconds: 30 },
    ]);
  });

  it('re-encodes the head and stream-copies through an on-keyframe end', () => {
    expect(planSmartCutSegments(12, 30, keyframes)).toEqual([
      { mode: 'encode', startSeconds: 12, endSeconds: 20 },
      { mode: 'copy', startSeconds: 20, endSeconds: 30 },
    ]);
  });

  it('stream-copies the middle and re-encodes the tail', () => {
    expect(planSmartCutSegments(10, 28, keyframes)).toEqual([
      { mode: 'copy', startSeconds: 10, endSeconds: 20 },
      { mode: 'encode', startSeconds: 20, endSeconds: 28 },
    ]);
  });

  it('re-encodes the head and tail when both boundaries sit inside GOPs', () => {
    expect(planSmartCutSegments(12, 28, keyframes)).toEqual([
      { mode: 'encode', startSeconds: 12, endSeconds: 20 },
      { mode: 'encode', startSeconds: 20, endSeconds: 28 },
    ]);
  });

  it('re-encodes a short range that sits inside one GOP', () => {
    expect(planSmartCutSegments(12, 18, keyframes)).toEqual([
      { mode: 'encode', startSeconds: 12, endSeconds: 18 },
    ]);
  });
});

describe('shouldUseFullFilterEncode', () => {
  it('returns false for a single stream-copy segment', () => {
    expect(shouldUseFullFilterEncode([{ mode: 'copy', startSeconds: 10, endSeconds: 30 }])).toBe(
      false
    );
  });

  it('returns false for a single encode segment', () => {
    expect(shouldUseFullFilterEncode([{ mode: 'encode', startSeconds: 12, endSeconds: 18 }])).toBe(
      false
    );
  });

  it('returns true when multiple segments would need joining', () => {
    expect(
      shouldUseFullFilterEncode([
        { mode: 'encode', startSeconds: 12, endSeconds: 20 },
        { mode: 'copy', startSeconds: 20, endSeconds: 30 },
      ])
    ).toBe(true);
  });
});

describe('keyframe helpers', () => {
  it('detects on-keyframe timestamps within epsilon', () => {
    expect(isOnKeyframe(10.02, [10, 20])).toBe(true);
    expect(isOnKeyframe(11, [10, 20])).toBe(false);
  });

  it('finds the next and previous keyframes', () => {
    expect(findNextKeyframeAfter(12, [10, 20, 30])).toBe(20);
    expect(findPrevKeyframeAtOrBefore(28, [10, 20, 30])).toBe(20);
  });
});

describe('resolveSmartCutSegmentTrimBounds', () => {
  it('uses the planned segment timestamps for joins on shared keyframes', () => {
    expect(
      resolveSmartCutSegmentTrimBounds({ mode: 'copy', startSeconds: 20, endSeconds: 30 })
    ).toEqual({
      startSeconds: 20,
      endSeconds: 30,
    });
    expect(
      resolveSmartCutSegmentTrimBounds({ mode: 'encode', startSeconds: 12, endSeconds: 20 })
    ).toEqual({
      startSeconds: 12,
      endSeconds: 20,
    });
  });
});

describe('parseVideoFrameRate', () => {
  it('parses rational ffprobe frame rates', () => {
    expect(parseVideoFrameRate('30/1')).toBe(30);
    expect(parseVideoFrameRate('30000/1001')).toBe(29.97);
  });

  it('returns null for invalid values', () => {
    expect(parseVideoFrameRate('0/0')).toBeNull();
    expect(parseVideoFrameRate('')).toBeNull();
  });
});

describe('resolveSmartCutFrameRate', () => {
  it('prefers r_frame_rate when avg_frame_rate is misleadingly low', () => {
    expect(resolveSmartCutFrameRate('30/1', '25/2')).toBe(30);
    expect(resolveSmartCutFrameRateRational('30/1', '25/2')).toBe('30/1');
  });

  it('keeps the source rational frame rate for encode timing', () => {
    expect(resolveSmartCutFrameRateRational('30000/1001', '25/2')).toBe('30000/1001');
    expect(resolveSmartCutFrameRate('30000/1001', '25/2')).toBe(29.97);
  });

  it('normalizes common broadcast rates', () => {
    expect(normalizeStandardFrameRate(29.969)).toBe(29.97);
  });
});

describe('parseAudioSampleRate', () => {
  it('parses ffprobe sample rates', () => {
    expect(parseAudioSampleRate('44100')).toBe(44_100);
  });
});

describe('buildSmartCutEncodeFilterGraph', () => {
  it('uses trim filters with zero-based pts and no in-graph reframing', () => {
    expect(buildSmartCutEncodeFilterGraph(12, 20)).toContain('trim=start=12.000000:end=20.000000');
    expect(buildSmartCutEncodeFilterGraph(12, 20)).not.toContain('fps=');
    expect(buildSmartCutEncodeFilterGraph(12, 20)).toContain('aresample=async=1:first_pts=0');
  });

  it('formats common broadcast frame rates for the fps filter', () => {
    expect(formatFpsFilterValue(29.97)).toBe('30000/1001');
  });
});

describe('buildSmartCutFullEncodeFfmpegArgs', () => {
  it('encodes the full trim range in one filter pass', () => {
    const args = buildSmartCutFullEncodeFfmpegArgs(
      '/tmp/source.mp4',
      '/tmp/out.mp4',
      12,
      28,
      '30000/1001',
      44_100
    );

    expect(args).not.toContain('-ss');
    expect(args).toEqual(
      expect.arrayContaining([
        '-filter_complex',
        buildSmartCutEncodeFilterGraph(12, 28),
        '-map',
        '[v]',
        '-map',
        '[a]',
        ...buildSmartCutFilteredVideoEncodeArgs('30000/1001'),
        '-c:a',
        'aac',
        '-ar',
        '44100',
        '-movflags',
        '+faststart',
      ])
    );
  });
});

describe('buildSmartCutSegmentFfmpegArgs', () => {
  it('uses a filter graph for encode segments to avoid seek timestamp drift', () => {
    const args = buildSmartCutSegmentFfmpegArgs(
      '/tmp/source.mp4',
      '/tmp/out.mp4',
      { mode: 'encode', startSeconds: 12, endSeconds: 20 },
      '30000/1001',
      44_100
    );

    expect(args).toEqual(
      buildSmartCutFullEncodeFfmpegArgs(
        '/tmp/source.mp4',
        '/tmp/out.mp4',
        12,
        20,
        '30000/1001',
        44_100
      )
    );
  });

  it('uses keyframe seek before input for standalone copy segments', () => {
    const args = buildSmartCutSegmentFfmpegArgs(
      '/tmp/source.mp4',
      '/tmp/out.mp4',
      { mode: 'copy', startSeconds: 20, endSeconds: 30 },
      '30/1',
      44_100
    );

    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(args).toEqual(
      expect.arrayContaining([
        '-ss',
        '20',
        '-i',
        '/tmp/source.mp4',
        '-to',
        '30',
        '-reset_timestamps',
        '1',
        '-avoid_negative_ts',
        'make_zero',
        '-c',
        'copy',
        '-movflags',
        '+faststart',
      ])
    );
    expect(args).not.toContain('-c:a');
  });
});
