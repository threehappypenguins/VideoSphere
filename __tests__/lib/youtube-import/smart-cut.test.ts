import { describe, expect, it } from 'vitest';
import {
  buildSmartCutAudioTrackArgs,
  buildSmartCutAudioTrimFilterGraph,
  buildSmartCutConcatListContent,
  buildSmartCutConcatVideoArgs,
  buildSmartCutCopyOnlyArgs,
  buildSmartCutCopySegmentArgs,
  buildSmartCutEncodeOnlyArgs,
  buildSmartCutHeadSegmentArgs,
  buildSmartCutMuxVideoAudioArgs,
  buildSmartCutTrimFilterGraph,
  buildSmartCutVideoTrimFilterGraph,
  computeSmartCutCopyTimestampOffset,
  findNextKeyframeAfter,
  isOnKeyframe,
  normalizeStandardFrameRate,
  parseAudioSampleRate,
  parseStreamEndSeconds,
  parseVideoFrameRate,
  planSmartCut,
  resolveEffectiveTrimEnd,
  resolveSmartCutFrameRate,
  resolveSmartCutFrameRateRational,
} from '@/lib/youtube-import/smart-cut';

describe('planSmartCut', () => {
  const keyframes = [0, 10, 20, 30, 40, 50];

  it('stream-copies when start is already on a keyframe', () => {
    expect(planSmartCut(10, 30, keyframes)).toEqual({
      kind: 'copy',
      startSeconds: 10,
      endSeconds: 30,
    });
  });

  it('stream-copies when start is on a keyframe even if end is not', () => {
    expect(planSmartCut(10, 28, keyframes)).toEqual({
      kind: 'copy',
      startSeconds: 10,
      endSeconds: 28,
    });
  });

  it('re-encodes only the head and stream-copies through an on-keyframe end', () => {
    expect(planSmartCut(12, 30, keyframes)).toEqual({
      kind: 'encode-then-copy',
      encodeStart: 12,
      encodeEnd: 20,
      copyStart: 20,
      copyEnd: 30,
    });
  });

  it('re-encodes only the head and stream-copies straight through to an off-keyframe end', () => {
    expect(planSmartCut(12, 28, keyframes)).toEqual({
      kind: 'encode-then-copy',
      encodeStart: 12,
      encodeEnd: 20,
      copyStart: 20,
      copyEnd: 28,
    });
  });

  it('encodes the whole range when it sits inside a single GOP', () => {
    expect(planSmartCut(12, 18, keyframes)).toEqual({
      kind: 'encode',
      startSeconds: 12,
      endSeconds: 18,
    });
  });

  it('encodes the whole range when no keyframe exists after start', () => {
    expect(planSmartCut(45, 55, [0, 10, 20, 30, 40])).toEqual({
      kind: 'encode',
      startSeconds: 45,
      endSeconds: 55,
    });
  });

  it('throws when end is not after start', () => {
    expect(() => planSmartCut(30, 30, keyframes)).toThrow();
    expect(() => planSmartCut(30, 20, keyframes)).toThrow();
  });
});

describe('isOnKeyframe / findNextKeyframeAfter', () => {
  it('treats near-keyframe timestamps as aligned', () => {
    expect(isOnKeyframe(20.01, [0, 20, 40])).toBe(true);
    expect(isOnKeyframe(20.2, [0, 20, 40])).toBe(false);
  });

  it('finds the next keyframe strictly after a timestamp', () => {
    expect(findNextKeyframeAfter(12, [0, 20, 40])).toBe(20);
    expect(findNextKeyframeAfter(20, [0, 20, 40])).toBe(40);
    expect(findNextKeyframeAfter(45, [0, 20, 40])).toBeNull();
  });
});

describe('frame rate / sample rate parsing', () => {
  it('parses rational frame rates', () => {
    expect(parseVideoFrameRate('30000/1001')).toBeCloseTo(29.97, 2);
    expect(parseVideoFrameRate('0/0')).toBeNull();
  });

  it('normalizes close-enough rates to broadcast standards', () => {
    expect(normalizeStandardFrameRate(29.971)).toBe(29.97);
  });

  it('prefers r_frame_rate when avg_frame_rate looks misleadingly low', () => {
    expect(resolveSmartCutFrameRateRational('30/1', '12.5/1')).toBe('30/1');
    expect(resolveSmartCutFrameRate('30/1', '12.5/1')).toBe(30);
  });

  it('parses audio sample rate', () => {
    expect(parseAudioSampleRate('44100')).toBe(44_100);
    expect(parseAudioSampleRate('not-a-number')).toBeNull();
  });
});

describe('trim filter graphs', () => {
  it('builds separate video and audio trim graphs', () => {
    expect(buildSmartCutVideoTrimFilterGraph(12, 20)).toContain(
      'trim=start=12.000000:end=20.000000'
    );
    expect(buildSmartCutVideoTrimFilterGraph(12, 20)).toContain('setpts=PTS-STARTPTS');
    expect(buildSmartCutAudioTrimFilterGraph(12, 20)).toContain(
      'atrim=start=12.000000:end=20.000000'
    );
    expect(buildSmartCutAudioTrimFilterGraph(12, 20)).not.toContain('aresample=async');
  });

  it('can preserve absolute PTS for MPEG-TS head segments', () => {
    expect(buildSmartCutVideoTrimFilterGraph(12, 20, { rebaseTimestamps: false })).toBe(
      '[0:v]trim=start=12.000000:end=20.000000[v]'
    );
  });

  it('combines video and audio graphs for single-pass encode', () => {
    expect(buildSmartCutTrimFilterGraph(12, 20)).toBe(
      `${buildSmartCutVideoTrimFilterGraph(12, 20)};${buildSmartCutAudioTrimFilterGraph(12, 20)}`
    );
  });
});

describe('buildSmartCutCopyOnlyArgs', () => {
  it('uses a plain duration-based stream copy straight to MP4', () => {
    const args = buildSmartCutCopyOnlyArgs('/tmp/source.mp4', '/tmp/out.mp4', 10, 30);

    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(args).toEqual(
      expect.arrayContaining([
        '-ss',
        '10',
        '-i',
        '/tmp/source.mp4',
        '-t',
        '20',
        '-map',
        '0',
        '-c',
        'copy',
        '-reset_timestamps',
        '1',
        '-avoid_negative_ts',
        'make_zero',
        '-movflags',
        '+faststart',
      ])
    );
  });
});

describe('buildSmartCutEncodeOnlyArgs', () => {
  it('fast-seeks with -copyts and trims on absolute timestamps', () => {
    const args = buildSmartCutEncodeOnlyArgs(
      '/tmp/source.mp4',
      '/tmp/out.mp4',
      120,
      126,
      '30000/1001',
      44_100
    );

    expect(args).toContain('-copyts');
    expect(args[args.indexOf('-ss') + 1]).toBe('105');
    expect(args).toContain('-filter_complex');
    expect(args[args.indexOf('-filter_complex') + 1]).toBe(buildSmartCutTrimFilterGraph(120, 126));
  });
});

describe('buildSmartCutHeadSegmentArgs', () => {
  it('outputs video-only MP4 with rebased PTS', () => {
    const args = buildSmartCutHeadSegmentArgs(
      '/tmp/source.mp4',
      '/tmp/head.mp4',
      12,
      20,
      '30000/1001'
    );

    expect(args).toEqual(
      expect.arrayContaining([
        '-filter_complex',
        buildSmartCutVideoTrimFilterGraph(12, 20),
        '-map',
        '[v]',
        '-an',
        '-y',
        '/tmp/head.mp4',
      ])
    );
    expect(args).not.toContain('h264_mp4toannexb');
    expect(args.filter((arg) => arg === '[a]')).toHaveLength(0);
    expect(args).not.toContain('-c:a');
  });
});

describe('computeSmartCutCopyTimestampOffset', () => {
  it('offsets the copy segment to continue after the rebased head duration', () => {
    expect(computeSmartCutCopyTimestampOffset(12, 20, 20)).toBe(-12);
    expect(computeSmartCutCopyTimestampOffset(3281, 3289, 3289)).toBe(-3281);
  });
});

describe('buildSmartCutCopySegmentArgs', () => {
  it('copies video only from the keyframe boundary with a timestamp offset', () => {
    const args = buildSmartCutCopySegmentArgs('/tmp/source.mp4', '/tmp/copy.mp4', 12, 20, 20, 47.5);

    expect(args).toEqual(
      expect.arrayContaining([
        '-ss',
        '20',
        '-copyts',
        '-i',
        '/tmp/source.mp4',
        '-t',
        '27.5',
        '-output_ts_offset',
        '-12',
        '-map',
        '0:v:0',
        '-c:v',
        'copy',
        '-bsf:v',
        'dump_extra',
        '-an',
        '-y',
        '/tmp/copy.mp4',
      ])
    );
    expect(args).not.toContain('mpegts');
  });
});

describe('buildSmartCutConcatListContent', () => {
  it('escapes single quotes in segment paths', () => {
    expect(buildSmartCutConcatListContent(["/tmp/o'clock.mp4", '/tmp/copy.mp4'])).toBe(
      "file '/tmp/o'\\''clock.mp4'\nfile '/tmp/copy.mp4'"
    );
  });
});

describe('buildSmartCutConcatVideoArgs', () => {
  it('joins MP4 segments through the concat demuxer', () => {
    const args = buildSmartCutConcatVideoArgs('/tmp/concat.txt', '/tmp/video.mp4');

    expect(args).toEqual(
      expect.arrayContaining([
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        '/tmp/concat.txt',
        '-c',
        'copy',
        '-y',
        '/tmp/video.mp4',
      ])
    );
  });
});

describe('buildSmartCutAudioTrackArgs', () => {
  it('stream-copies one continuous audio track for the full trim range', () => {
    const args = buildSmartCutAudioTrackArgs('/tmp/source.mp4', '/tmp/audio.m4a', 12, 47.5);

    expect(args).toEqual(
      expect.arrayContaining([
        '-ss',
        '12',
        '-i',
        '/tmp/source.mp4',
        '-t',
        '35.5',
        '-map',
        '0:a:0',
        '-c:a',
        'copy',
        '-vn',
      ])
    );
    expect(args).not.toContain('-filter_complex');
    expect(args).not.toContain('aac');
  });
});

describe('buildSmartCutMuxVideoAudioArgs', () => {
  it('muxes a joined video file with a separate audio file', () => {
    const args = buildSmartCutMuxVideoAudioArgs('/tmp/video.mp4', '/tmp/audio.m4a', '/tmp/out.mp4');

    expect(args).toEqual(
      expect.arrayContaining([
        '-i',
        '/tmp/video.mp4',
        '-i',
        '/tmp/audio.m4a',
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-c:v',
        'copy',
        '-c:a',
        'copy',
        '-avoid_negative_ts',
        'make_zero',
        '-shortest',
        '-movflags',
        '+faststart',
      ])
    );
    expect(args).not.toContain('concat:');
    expect(args).not.toContain('+genpts');
  });
});

describe('resolveEffectiveTrimEnd', () => {
  it('clamps to the shorter stream when audio ends before video', () => {
    expect(
      resolveEffectiveTrimEnd(5, 90, {
        videoEndSeconds: 91.79,
        audioEndSeconds: 85.75,
      })
    ).toBe(85.75);
  });

  it('keeps the requested end when both streams cover it', () => {
    expect(
      resolveEffectiveTrimEnd(5, 60, {
        videoEndSeconds: 120,
        audioEndSeconds: 120,
      })
    ).toBe(60);
  });
});

describe('parseStreamEndSeconds', () => {
  it('adds start_time and duration', () => {
    expect(parseStreamEndSeconds({ start_time: '2.5', duration: '83.25' })).toBe(85.75);
  });
});
