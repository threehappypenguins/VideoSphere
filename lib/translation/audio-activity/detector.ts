// =============================================================================
// Audio activity detection — streaming detector with hysteresis
// =============================================================================
// Wraps a window classifier in a ring buffer plus a state machine. Hysteresis and
// a minimum dwell time matter more than raw classifier accuracy here: a detector
// that flickers between states mid-sermon is worse than one that reacts a second
// or two late.
// =============================================================================

import {
  createHeuristicAudioActivityClassifier,
  type ProviderMusicHint,
} from '@/lib/translation/audio-activity/heuristic-classifier';
import { pcm16ToFloat32, resampleMono } from '@/lib/translation/audio-activity/features';
import type {
  AudioActivityClassifier,
  AudioActivityScores,
  AudioActivityState,
} from '@/lib/translation/audio-activity/types';

/** Analysis window length in milliseconds. */
export const DEFAULT_WINDOW_MS = 2000;
/** Interval between classifications in milliseconds. */
export const DEFAULT_HOP_MS = 500;
/**
 * Sustained music evidence required before suppressing captions.
 *
 * Deliberately several windows long. Measured against a full service recording, real
 * songs last minutes while false positives last one or two windows, so requiring the
 * evidence to persist discriminates far better than any score threshold: the score
 * ranges of true songs and false positives overlap almost completely.
 */
export const DEFAULT_ENTER_MUSIC_MS = 2500;
/**
 * Sustained speech evidence required before resuming captions.
 *
 * Longer than {@link DEFAULT_ENTER_MUSIC_MS} on purpose. Leaving music too eagerly is
 * the more expensive mistake — it lets lyrics through as captions — and a breath gap
 * mid-song reads as speech for a window or two. A late resume costs nothing because
 * the buffered pre-roll is replayed once speech is confirmed.
 */
export const DEFAULT_EXIT_MUSIC_MS = 3000;
/** Minimum time to remain in the music state, so verse gaps cannot cause flapping. */
export const DEFAULT_MIN_MUSIC_DWELL_MS = 5000;
/** Music score at or above which a window votes music. */
export const DEFAULT_MUSIC_THRESHOLD = 0.55;
/** Music score at or below which a window votes speech; between the two is abstention. */
export const DEFAULT_SPEECH_THRESHOLD = 0.4;
/** How long a provider music event stays influential without renewal. */
const PROVIDER_HINT_TTL_MS = 3000;

/** Sample rate the detector analyses at; ingest already delivers this. */
const ANALYSIS_SAMPLE_RATE = 16000;

/**
 * Tuning knobs for {@link createAudioActivityDetector}.
 */
export interface AudioActivityDetectorOptions {
  /** Analysis window length in milliseconds. */
  windowMs?: number;
  /** Interval between classifications in milliseconds. */
  hopMs?: number;
  /** Sustained music evidence required before entering the music state. */
  enterMusicMs?: number;
  /** Sustained speech evidence required before leaving the music state. */
  exitMusicMs?: number;
  /** Minimum time to remain in the music state once entered. */
  minMusicDwellMs?: number;
  /** Music score at or above which a window votes music. */
  musicThreshold?: number;
  /** Music score at or below which a window votes speech. */
  speechThreshold?: number;
  /** Overrides the default heuristic classifier (e.g. a neural model). */
  classifier?: AudioActivityClassifier;
}

/**
 * Fully resolved detector settings, with every default applied.
 */
export type ResolvedAudioActivityDetectorOptions = Required<
  Omit<AudioActivityDetectorOptions, 'classifier'>
>;

/**
 * Applies defaults to partial detector options and reconciles the two thresholds.
 *
 * A window votes music at or above `musicThreshold` and speech at or below
 * `speechThreshold`, abstaining in between. If `speechThreshold` were allowed to sit
 * above `musicThreshold` the bands would overlap and every scored window would vote
 * music, so the speech bar is clamped below the music bar.
 * @param options - Partial overrides, typically from the environment.
 * @returns Settings with defaults applied and thresholds guaranteed not to cross.
 */
export function resolveAudioActivityDetectorOptions(
  options: AudioActivityDetectorOptions = {}
): ResolvedAudioActivityDetectorOptions {
  const musicThreshold = options.musicThreshold ?? DEFAULT_MUSIC_THRESHOLD;
  const speechThreshold = Math.min(
    options.speechThreshold ?? DEFAULT_SPEECH_THRESHOLD,
    musicThreshold
  );

  return {
    windowMs: options.windowMs ?? DEFAULT_WINDOW_MS,
    hopMs: options.hopMs ?? DEFAULT_HOP_MS,
    enterMusicMs: options.enterMusicMs ?? DEFAULT_ENTER_MUSIC_MS,
    exitMusicMs: options.exitMusicMs ?? DEFAULT_EXIT_MUSIC_MS,
    minMusicDwellMs: options.minMusicDwellMs ?? DEFAULT_MIN_MUSIC_DWELL_MS,
    musicThreshold,
    speechThreshold,
  };
}

/**
 * Result of feeding audio to the detector.
 */
export interface AudioActivityUpdate {
  /** State after this update. */
  state: AudioActivityState;
  /** True when this update changed the state. */
  changed: boolean;
  /** Scores from the most recent classification, or null when none ran yet. */
  scores: AudioActivityScores | null;
}

/**
 * Rolling speech-versus-music detector over a live PCM stream.
 */
export interface AudioActivityDetector {
  /** Identifier of the underlying classifier. */
  readonly classifierId: string;
  /** Settings actually in effect, after defaults and threshold reconciliation. */
  readonly options: ResolvedAudioActivityDetectorOptions;
  /** Current committed state. */
  readonly state: AudioActivityState;
  /**
   * Feeds a PCM chunk and advances the state machine.
   * @param pcm - Raw PCM16 LE mono bytes.
   * @param sampleRate - Sample rate of `pcm` in Hz.
   * @returns Current state, whether it changed, and the latest scores.
   */
  push(pcm: Buffer, sampleRate: number): AudioActivityUpdate;
  /**
   * Records a music event reported by the upstream ASR provider.
   * @param active - True when a music event started, false when it ended.
   * @param confidence - Provider confidence in `[0, 1]`.
   */
  noteProviderMusicEvent(active: boolean, confidence: number): void;
  /** Most recent classification, or null when none has run. */
  lastScores(): AudioActivityScores | null;
  /** Clears buffered audio and returns to the speech state. */
  reset(): void;
}

/**
 * Creates a streaming speech/music detector.
 *
 * Starts in the `speech` state so a service that opens with preaching is captioned
 * immediately rather than waiting for the first window to fill.
 * @param options - Window, hysteresis, and threshold overrides.
 * @returns Detector instance holding its own ring buffer and state.
 */
export function createAudioActivityDetector(
  options: AudioActivityDetectorOptions = {}
): AudioActivityDetector {
  const resolved = resolveAudioActivityDetectorOptions(options);
  const {
    windowMs,
    hopMs,
    enterMusicMs,
    exitMusicMs,
    minMusicDwellMs,
    musicThreshold,
    speechThreshold,
  } = resolved;

  const windowSamples = Math.max(1, Math.round((ANALYSIS_SAMPLE_RATE * windowMs) / 1000));
  const hopSamples = Math.max(1, Math.round((ANALYSIS_SAMPLE_RATE * hopMs) / 1000));

  const ring = new Float32Array(windowSamples);
  let ringWrite = 0;
  let ringFilled = 0;
  let samplesSinceClassify = 0;

  let providerHint: (ProviderMusicHint & { at: number }) | null = null;

  const classifier =
    options.classifier ??
    createHeuristicAudioActivityClassifier({
      providerHint: () => {
        if (!providerHint) return null;
        if (Date.now() - providerHint.at > PROVIDER_HINT_TTL_MS) return null;
        return { active: providerHint.active, confidence: providerHint.confidence };
      },
    });

  let state: AudioActivityState = 'speech';
  let candidate: 'speech' | 'music' | null = null;
  let candidateMs = 0;
  let dwellMs = 0;
  let scores: AudioActivityScores | null = null;

  /**
   * Copies samples into the ring buffer, oldest-first ordering preserved on read.
   * @param samples - Samples to append.
   */
  function writeRing(samples: Float32Array): void {
    for (let i = 0; i < samples.length; i += 1) {
      ring[ringWrite] = samples[i]!;
      ringWrite = (ringWrite + 1) % windowSamples;
      if (ringFilled < windowSamples) ringFilled += 1;
    }
  }

  /**
   * Reads the ring buffer in chronological order.
   * @returns Window samples, oldest first.
   */
  function readRing(): Float32Array {
    const out = new Float32Array(ringFilled);
    const start = (ringWrite - ringFilled + windowSamples) % windowSamples;
    for (let i = 0; i < ringFilled; i += 1) {
      out[i] = ring[(start + i) % windowSamples]!;
    }
    return out;
  }

  /**
   * Applies one classification result to the hysteresis state machine.
   * @param result - Latest window scores.
   * @param advanceMs - Audio milliseconds elapsed since the previous classification.
   * @returns True when the committed state changed.
   */
  function advance(result: AudioActivityScores, advanceMs: number): boolean {
    dwellMs += advanceMs;

    // Silence and mid-range scores abstain: they neither build a case for a new
    // state nor undo one already building. A gap between verses is not evidence
    // that the singing stopped.
    let vote: 'speech' | 'music' | null = null;
    if (!result.silent) {
      if (result.music >= musicThreshold) vote = 'music';
      else if (result.music <= speechThreshold) vote = 'speech';
    }

    if (vote === null) return false;

    if (vote === state) {
      candidate = null;
      candidateMs = 0;
      return false;
    }

    if (vote === candidate) {
      candidateMs += advanceMs;
    } else {
      candidate = vote;
      candidateMs = advanceMs;
    }

    const required = vote === 'music' ? enterMusicMs : exitMusicMs;
    if (candidateMs < required) return false;
    if (state === 'music' && dwellMs < minMusicDwellMs) return false;

    state = vote;
    candidate = null;
    candidateMs = 0;
    dwellMs = 0;
    return true;
  }

  return {
    classifierId: classifier.id,
    options: resolved,
    get state() {
      return state;
    },
    push(pcm: Buffer, sampleRate: number): AudioActivityUpdate {
      const floats = pcm16ToFloat32(pcm);
      const samples =
        sampleRate === ANALYSIS_SAMPLE_RATE
          ? floats
          : resampleMono(floats, sampleRate, ANALYSIS_SAMPLE_RATE);

      writeRing(samples);
      samplesSinceClassify += samples.length;

      if (ringFilled < windowSamples || samplesSinceClassify < hopSamples) {
        return { state, changed: false, scores };
      }

      const advanceMs = (samplesSinceClassify / ANALYSIS_SAMPLE_RATE) * 1000;
      samplesSinceClassify = 0;
      scores = classifier.classify(readRing(), ANALYSIS_SAMPLE_RATE);
      const changed = advance(scores, advanceMs);
      return { state, changed, scores };
    },
    noteProviderMusicEvent(active: boolean, confidence: number): void {
      providerHint = { active, confidence, at: Date.now() };
    },
    lastScores(): AudioActivityScores | null {
      return scores;
    },
    reset(): void {
      ring.fill(0);
      ringWrite = 0;
      ringFilled = 0;
      samplesSinceClassify = 0;
      providerHint = null;
      state = 'speech';
      candidate = null;
      candidateMs = 0;
      dwellMs = 0;
      scores = null;
    },
  };
}
