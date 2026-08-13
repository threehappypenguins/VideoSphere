// =============================================================================
// Spoken-translation lag instrumentation
// =============================================================================
// Listeners report that TTS drifts progressively behind the preacher in wordier target
// languages. Two very different causes produce that symptom and only one is fixable by
// speaking faster, so this tracker separates them:
//
//   pipelineMs — the fixed cost of ASR final -> translate -> synthesize. Constant, and
//                as unavoidable as a human interpreter's lag.
//   backlogMs  — time a clip waits behind audio still playing. Grows without bound
//                whenever speech takes longer to say in the target language than it took
//                in the source, because nothing in the delivery path can recover it.
//
// The number that decides whether backlog grows is `sustainedExpansion`: total spoken
// audio over the source speech it covers. At 1.2 a listener falls a further 12 seconds
// behind for every minute of preaching, no matter how the queue is scheduled.
//
// This module is pure so it can be unit-tested and replayed offline; the caller owns
// clocks, logging, and whether measurement is enabled at all.
// =============================================================================

/**
 * Source gaps longer than this are treated as a pause, a hymn, or a technical break
 * rather than speech the segment covers, so they are excluded from expansion ratios.
 * Silence genuinely drains the backlog, but counting it as "source speech" would make
 * every language look comfortably fast.
 */
export const TTS_TIMING_MAX_SOURCE_GAP_MS = 10_000;

/** One measured spoken segment. */
export interface TtsSegmentTiming {
  /** Position of this clip in the language's spoken sequence, starting at 1. */
  index: number;
  /** Milliseconds from source finalisation to the audio URL reaching listeners. */
  pipelineMs: number;
  /** Additional milliseconds this clip waits behind audio already queued. */
  backlogMs: number;
  /** Total milliseconds the spoken audio starts behind the source: pipeline plus backlog. */
  lagMs: number;
  /** Playback duration of the synthesised clip. */
  audioMs: number;
  /** Source speech this clip covers, or null for the first clip or after a long gap. */
  sourceMs: number | null;
  /** `audioMs / sourceMs`, or null when `sourceMs` is unknown. Above 1 means drift. */
  expansion: number | null;
}

/** Aggregate view over every segment recorded for one language. */
export interface TtsTimingSummary {
  /** Clips measured. */
  count: number;
  /** Median fixed pipeline latency. */
  pipelineP50Ms: number;
  /** Median queue backlog. */
  backlogP50Ms: number;
  /** 95th-percentile queue backlog. */
  backlogP95Ms: number;
  /** Median total lag behind the source. */
  lagP50Ms: number;
  /** 95th-percentile total lag behind the source. */
  lagP95Ms: number;
  /** Worst total lag observed. */
  lagMaxMs: number;
  /** Median per-segment expansion ratio, or null when no segment had a source span. */
  expansionP50: number | null;
  /**
   * Total spoken audio over total source speech. This is the drift slope: above 1.0 the
   * backlog grows for as long as the speaker keeps going. Null when nothing qualified.
   */
  sustainedExpansion: number | null;
  /** Seconds of lag added per minute of continuous speech, derived from the slope. */
  driftSecondsPerMinute: number | null;
}

/** Accumulates spoken-lag measurements for a single listen language. */
export interface TtsTimingTracker {
  /**
   * Records one delivered clip and returns its measurements.
   * @param sample - Source finalisation time, broadcast time, and clip duration.
   * @returns Measurements for this clip.
   */
  record(sample: { createdAt: number; broadcastAt: number; audioMs: number }): TtsSegmentTiming;
  /**
   * Summarises everything recorded so far.
   * @returns Aggregates, or null before any clip has been recorded.
   */
  summary(): TtsTimingSummary | null;
}

/**
 * Nearest-rank percentile over an unsorted sample.
 * @param values - Sample values; must be non-empty.
 * @param fraction - Percentile as a fraction between 0 and 1.
 * @returns The percentile value.
 */
function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(fraction * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))]!;
}

/**
 * Creates a spoken-lag tracker for one listen language.
 *
 * Models the listener's playback queue rather than inspecting it: clips play strictly in
 * order and back to back, so the start time of each clip is whichever comes later — the
 * moment it arrives, or the moment the previous clip finishes. That reproduces what a
 * listener hears without needing any telemetry from their device.
 * @param options - Optional override for the source-gap cutoff.
 * @returns A tracker that records clips and reports aggregates.
 */
export function createTtsTimingTracker(options?: { maxSourceGapMs?: number }): TtsTimingTracker {
  const maxSourceGapMs = options?.maxSourceGapMs ?? TTS_TIMING_MAX_SOURCE_GAP_MS;

  const pipeline: number[] = [];
  const backlog: number[] = [];
  const lag: number[] = [];
  const expansions: number[] = [];
  let totalAudioMs = 0;
  let totalSourceMs = 0;
  let lastCreatedAt: number | null = null;
  let queueEmptyAt = 0;
  let count = 0;

  return {
    record({ createdAt, broadcastAt, audioMs }) {
      count += 1;

      const startAt = Math.max(broadcastAt, queueEmptyAt);
      const pipelineMs = Math.max(0, broadcastAt - createdAt);
      const backlogMs = Math.max(0, startAt - broadcastAt);
      const lagMs = pipelineMs + backlogMs;
      queueEmptyAt = startAt + audioMs;

      // A final arrives at the end of the speech it transcribes, so the gap since the
      // previous final approximates how long this segment took to say in the source.
      const gap = lastCreatedAt === null ? null : createdAt - lastCreatedAt;
      const sourceMs = gap !== null && gap > 0 && gap <= maxSourceGapMs ? gap : null;
      lastCreatedAt = createdAt;

      const expansion = sourceMs === null ? null : audioMs / sourceMs;
      if (sourceMs !== null) {
        expansions.push(expansion!);
        totalAudioMs += audioMs;
        totalSourceMs += sourceMs;
      }

      pipeline.push(pipelineMs);
      backlog.push(backlogMs);
      lag.push(lagMs);

      return { index: count, pipelineMs, backlogMs, lagMs, audioMs, sourceMs, expansion };
    },

    summary() {
      if (count === 0) return null;
      const sustainedExpansion = totalSourceMs > 0 ? totalAudioMs / totalSourceMs : null;
      return {
        count,
        pipelineP50Ms: percentile(pipeline, 0.5),
        backlogP50Ms: percentile(backlog, 0.5),
        backlogP95Ms: percentile(backlog, 0.95),
        lagP50Ms: percentile(lag, 0.5),
        lagP95Ms: percentile(lag, 0.95),
        lagMaxMs: Math.max(...lag),
        expansionP50: expansions.length > 0 ? percentile(expansions, 0.5) : null,
        sustainedExpansion,
        driftSecondsPerMinute: sustainedExpansion === null ? null : (sustainedExpansion - 1) * 60,
      };
    },
  };
}

/**
 * Whether spoken-lag measurements should be logged to the server console.
 *
 * Off by default: this is calibration instrumentation, and it prints one line per spoken
 * caption. Enable with `TRANSLATION_TTS_TIMING_LOG=on` while replaying or running a
 * service, read the per-language summaries, then turn it back off.
 * @returns True when timing logs are enabled.
 */
export function isTtsTimingLogEnabled(): boolean {
  const raw = (process.env.TRANSLATION_TTS_TIMING_LOG ?? '').trim().toLowerCase();
  return raw === 'on' || raw === 'true' || raw === '1' || raw === 'yes';
}

/**
 * Formats one segment's measurements as a single log line.
 * @param language - Listen language code.
 * @param timing - Measurements from `record`.
 * @returns Compact single-line summary.
 */
export function formatTtsSegmentTiming(language: string, timing: TtsSegmentTiming): string {
  const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;
  const parts = [
    `#${String(timing.index).padStart(3, ' ')}`,
    `lag=${seconds(timing.lagMs).padStart(6, ' ')}`,
    `pipeline=${seconds(timing.pipelineMs)}`,
    `backlog=${seconds(timing.backlogMs)}`,
    `audio=${seconds(timing.audioMs)}`,
    timing.sourceMs === null ? 'source=--' : `source=${seconds(timing.sourceMs)}`,
    timing.expansion === null ? 'expand=--' : `expand=${timing.expansion.toFixed(2)}`,
  ];
  return `[tts-timing ${language}] ${parts.join('  ')}`;
}

/**
 * Formats an aggregate summary as a multi-line block.
 * @param language - Listen language code.
 * @param summary - Aggregates from `summary`.
 * @returns Human-readable summary block.
 */
export function formatTtsTimingSummary(language: string, summary: TtsTimingSummary): string {
  const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;
  const lines = [
    `[tts-timing ${language}] ${summary.count} clips`,
    `  lag       p50 ${seconds(summary.lagP50Ms)}  p95 ${seconds(summary.lagP95Ms)}  max ${seconds(summary.lagMaxMs)}`,
    `  pipeline  p50 ${seconds(summary.pipelineP50Ms)}  (fixed cost; not recoverable by speaking faster)`,
    `  backlog   p50 ${seconds(summary.backlogP50Ms)}  p95 ${seconds(summary.backlogP95Ms)}`,
  ];
  if (summary.sustainedExpansion !== null && summary.driftSecondsPerMinute !== null) {
    const drift = summary.driftSecondsPerMinute;
    const verdict =
      drift <= 0
        ? 'keeps up with the source'
        : `falls ${drift.toFixed(1)}s further behind per minute of speech`;
    lines.push(
      `  expansion ${summary.sustainedExpansion.toFixed(2)}x sustained` +
        (summary.expansionP50 === null ? '' : `  p50 ${summary.expansionP50.toFixed(2)}x`) +
        `  -> ${verdict}`
    );
  }
  return lines.join('\n');
}
