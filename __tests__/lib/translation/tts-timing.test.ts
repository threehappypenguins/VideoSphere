// =============================================================================
// Tests for lib/translation/tts-timing
// =============================================================================
// The tracker exists to tell two causes of "TTS is behind" apart, so the tests are
// built around scenarios rather than around individual fields: a language that keeps up,
// one that expands and therefore drifts without bound, and a pause that drains the
// backlog. Timestamps are absolute milliseconds, as the hub supplies them.
// =============================================================================

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTtsTimingTracker,
  formatTtsSegmentTiming,
  formatTtsTimingSummary,
  isTtsTimingLogEnabled,
  TTS_TIMING_MAX_SOURCE_GAP_MS,
} from '@/lib/translation/tts-timing';

/** Fixed pipeline cost used throughout, so backlog is the only variable. */
const PIPELINE_MS = 3000;

/**
 * Records a run of segments that arrive back to back in the source.
 * @param tracker - Tracker under test.
 * @param options - Segment count, source span per segment, and clip duration.
 * @returns Measurements in order.
 */
function recordRun(
  tracker: ReturnType<typeof createTtsTimingTracker>,
  options: { count: number; sourceMs: number; audioMs: number; startAt?: number }
) {
  const start = options.startAt ?? 0;
  return Array.from({ length: options.count }, (_, i) => {
    const createdAt = start + i * options.sourceMs;
    return tracker.record({
      createdAt,
      broadcastAt: createdAt + PIPELINE_MS,
      audioMs: options.audioMs,
    });
  });
}

describe('createTtsTimingTracker', () => {
  it('returns no summary before anything is recorded', () => {
    expect(createTtsTimingTracker().summary()).toBeNull();
  });

  it('separates fixed pipeline latency from queue backlog', () => {
    const tracker = createTtsTimingTracker();
    const first = tracker.record({ createdAt: 0, broadcastAt: 3000, audioMs: 5000 });

    expect(first.pipelineMs).toBe(3000);
    expect(first.backlogMs).toBe(0);
    expect(first.lagMs).toBe(3000);
  });

  it('leaves the first segment without a source span', () => {
    const first = createTtsTimingTracker().record({
      createdAt: 10_000,
      broadcastAt: 13_000,
      audioMs: 4000,
    });

    expect(first.sourceMs).toBeNull();
    expect(first.expansion).toBeNull();
  });

  it('numbers segments from one', () => {
    const timings = recordRun(createTtsTimingTracker(), {
      count: 3,
      sourceMs: 4000,
      audioMs: 4000,
    });
    expect(timings.map((t) => t.index)).toEqual([1, 2, 3]);
  });

  describe('a language that keeps up', () => {
    it('never accumulates backlog when clips are shorter than the source', () => {
      const timings = recordRun(createTtsTimingTracker(), {
        count: 20,
        sourceMs: 4000,
        audioMs: 3200,
      });

      expect(timings.every((t) => t.backlogMs === 0)).toBe(true);
      expect(timings.every((t) => t.lagMs === PIPELINE_MS)).toBe(true);
    });

    it('reports expansion below 1 and no drift', () => {
      const tracker = createTtsTimingTracker();
      recordRun(tracker, { count: 20, sourceMs: 4000, audioMs: 3200 });
      const summary = tracker.summary()!;

      expect(summary.sustainedExpansion).toBeCloseTo(0.8, 6);
      expect(summary.driftSecondsPerMinute).toBeCloseTo(-12, 6);
      expect(summary.backlogP95Ms).toBe(0);
    });
  });

  describe('a wordier language that drifts', () => {
    it('accumulates backlog on every segment', () => {
      const timings = recordRun(createTtsTimingTracker(), {
        count: 4,
        sourceMs: 4000,
        audioMs: 5000,
      });

      expect(timings.map((t) => t.backlogMs)).toEqual([0, 1000, 2000, 3000]);
      expect(timings.map((t) => t.lagMs)).toEqual([3000, 4000, 5000, 6000]);
      expect(timings.every((t) => t.pipelineMs === PIPELINE_MS)).toBe(true);
    });

    it('derives the drift slope from sustained expansion', () => {
      const tracker = createTtsTimingTracker();
      recordRun(tracker, { count: 10, sourceMs: 4000, audioMs: 5000 });
      const summary = tracker.summary()!;

      expect(summary.sustainedExpansion).toBeCloseTo(1.25, 6);
      // A quarter more speaking time than source time is 15 extra seconds per minute.
      expect(summary.driftSecondsPerMinute).toBeCloseTo(15, 6);
    });

    it('grows lag without bound as the run gets longer', () => {
      const short = createTtsTimingTracker();
      recordRun(short, { count: 10, sourceMs: 4000, audioMs: 5000 });
      const long = createTtsTimingTracker();
      recordRun(long, { count: 60, sourceMs: 4000, audioMs: 5000 });

      expect(long.summary()!.lagMaxMs).toBeGreaterThan(short.summary()!.lagMaxMs);
      // Same slope regardless of duration: the ratio is a property of the language.
      expect(long.summary()!.sustainedExpansion).toBeCloseTo(
        short.summary()!.sustainedExpansion!,
        6
      );
    });
  });

  describe('pauses in the source', () => {
    it('drains accumulated backlog', () => {
      const tracker = createTtsTimingTracker();
      recordRun(tracker, { count: 4, sourceMs: 4000, audioMs: 5000 });

      // A hymn or a long silence: the queue empties well before the next final arrives.
      const afterPause = tracker.record({
        createdAt: 300_000,
        broadcastAt: 303_000,
        audioMs: 4000,
      });

      expect(afterPause.backlogMs).toBe(0);
      expect(afterPause.lagMs).toBe(PIPELINE_MS);
    });

    it('excludes the gap from expansion so silence is not counted as fast speech', () => {
      const tracker = createTtsTimingTracker();
      const first = tracker.record({ createdAt: 0, broadcastAt: 3000, audioMs: 4000 });
      const afterGap = tracker.record({
        createdAt: TTS_TIMING_MAX_SOURCE_GAP_MS + 1,
        broadcastAt: TTS_TIMING_MAX_SOURCE_GAP_MS + 3001,
        audioMs: 4000,
      });

      expect(first.sourceMs).toBeNull();
      expect(afterGap.sourceMs).toBeNull();
      expect(afterGap.expansion).toBeNull();
      expect(tracker.summary()!.sustainedExpansion).toBeNull();
    });

    it('counts a gap exactly at the cutoff', () => {
      const tracker = createTtsTimingTracker();
      tracker.record({ createdAt: 0, broadcastAt: 3000, audioMs: 4000 });
      const atCutoff = tracker.record({
        createdAt: TTS_TIMING_MAX_SOURCE_GAP_MS,
        broadcastAt: TTS_TIMING_MAX_SOURCE_GAP_MS + 3000,
        audioMs: 4000,
      });

      expect(atCutoff.sourceMs).toBe(TTS_TIMING_MAX_SOURCE_GAP_MS);
    });

    it('honours a custom cutoff', () => {
      const tracker = createTtsTimingTracker({ maxSourceGapMs: 2000 });
      tracker.record({ createdAt: 0, broadcastAt: 3000, audioMs: 1000 });
      const beyond = tracker.record({ createdAt: 2500, broadcastAt: 5500, audioMs: 1000 });

      expect(beyond.sourceMs).toBeNull();
    });
  });

  describe('summary aggregates', () => {
    it('reports percentiles over recorded lag', () => {
      const tracker = createTtsTimingTracker();
      recordRun(tracker, { count: 10, sourceMs: 4000, audioMs: 5000 });
      const summary = tracker.summary()!;

      expect(summary.count).toBe(10);
      expect(summary.pipelineP50Ms).toBe(PIPELINE_MS);
      expect(summary.lagP50Ms).toBeLessThan(summary.lagP95Ms);
      expect(summary.lagP95Ms).toBeLessThanOrEqual(summary.lagMaxMs);
      expect(summary.backlogP50Ms).toBeLessThan(summary.backlogP95Ms);
    });

    it('reports median expansion alongside the sustained ratio', () => {
      const tracker = createTtsTimingTracker();
      recordRun(tracker, { count: 5, sourceMs: 4000, audioMs: 4000 });
      const summary = tracker.summary()!;

      expect(summary.expansionP50).toBeCloseTo(1, 6);
      expect(summary.sustainedExpansion).toBeCloseTo(1, 6);
      expect(summary.driftSecondsPerMinute).toBeCloseTo(0, 6);
    });

    it('never reports negative lag when a clock skews backwards', () => {
      const timing = createTtsTimingTracker().record({
        createdAt: 5000,
        broadcastAt: 4000,
        audioMs: 1000,
      });

      expect(timing.pipelineMs).toBe(0);
      expect(timing.backlogMs).toBe(0);
      expect(timing.lagMs).toBe(0);
    });
  });
});

describe('formatTtsSegmentTiming', () => {
  it('labels the language and shows the lag breakdown', () => {
    const timing = createTtsTimingTracker().record({
      createdAt: 0,
      broadcastAt: 3000,
      audioMs: 5000,
    });
    const line = formatTtsSegmentTiming('fr', timing);

    expect(line).toContain('[tts-timing fr]');
    expect(line).toContain('pipeline=3.0s');
    expect(line).toContain('backlog=0.0s');
    expect(line).toContain('audio=5.0s');
  });

  it('marks an unknown source span rather than printing a misleading zero', () => {
    const timing = createTtsTimingTracker().record({
      createdAt: 0,
      broadcastAt: 3000,
      audioMs: 5000,
    });
    const line = formatTtsSegmentTiming('fr', timing);

    expect(line).toContain('source=--');
    expect(line).toContain('expand=--');
  });
});

describe('formatTtsTimingSummary', () => {
  it('spells out how fast a drifting language falls behind', () => {
    const tracker = createTtsTimingTracker();
    recordRun(tracker, { count: 10, sourceMs: 4000, audioMs: 5000 });
    const text = formatTtsTimingSummary('es', tracker.summary()!);

    expect(text).toContain('[tts-timing es] 10 clips');
    expect(text).toContain('1.25x sustained');
    expect(text).toContain('falls 15.0s further behind per minute');
  });

  it('says a language keeps up when it does', () => {
    const tracker = createTtsTimingTracker();
    recordRun(tracker, { count: 10, sourceMs: 4000, audioMs: 3200 });
    const text = formatTtsTimingSummary('nl', tracker.summary()!);

    expect(text).toContain('keeps up with the source');
  });

  it('omits the expansion line when no segment had a source span', () => {
    const tracker = createTtsTimingTracker();
    tracker.record({ createdAt: 0, broadcastAt: 3000, audioMs: 4000 });
    const text = formatTtsTimingSummary('de', tracker.summary()!);

    expect(text).not.toContain('expansion');
  });
});

describe('isTtsTimingLogEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is off by default', () => {
    vi.stubEnv('TRANSLATION_TTS_TIMING_LOG', undefined);
    expect(isTtsTimingLogEnabled()).toBe(false);
  });

  it.each(['on', 'ON', 'true', '1', 'yes', ' on '])('enables for %s', (value) => {
    vi.stubEnv('TRANSLATION_TTS_TIMING_LOG', value);
    expect(isTtsTimingLogEnabled()).toBe(true);
  });

  it.each(['off', 'false', '0', 'no', ''])('stays off for %s', (value) => {
    vi.stubEnv('TRANSLATION_TTS_TIMING_LOG', value);
    expect(isTtsTimingLogEnabled()).toBe(false);
  });
});
