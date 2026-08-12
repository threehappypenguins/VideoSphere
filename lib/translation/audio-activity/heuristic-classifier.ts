// =============================================================================
// Audio activity detection — heuristic (signal-processing) classifier
// =============================================================================
// Weighted vote over per-window features. Weights favour the two features that
// hold up for unaccompanied congregational singing (slow envelope modulation and
// sustained pitch), because instrument-oriented cues are unavailable there.
//
// Thresholds are starting points, not truths: calibrate against a recording of a
// real service with `pnpm translation:analyze-audio` before trusting them live.
// =============================================================================

import { extractAudioActivityFeatures } from '@/lib/translation/audio-activity/features';
import type {
  AudioActivityClassifier,
  AudioActivityFeatures,
  AudioActivityScores,
} from '@/lib/translation/audio-activity/types';

/** RMS below which a window is treated as silence rather than classified. */
export const ACTIVITY_SILENCE_RMS = 0.006;
/** Peak below which a window is treated as silence rather than classified. */
export const ACTIVITY_SILENCE_PEAK = 0.02;

/**
 * Relative influence of each feature on the music score. Sums to 1.
 */
const WEIGHTS = {
  /** Envelope modulation sitting at note rate rather than syllable rate. */
  slowModulation: 0.32,
  /** Pitch held steady in sustained notes. */
  pitchSustain: 0.28,
  /** Near-continuous voicing (choirs breathe together, speakers stop often). */
  voicing: 0.2,
  /** Few quiet gaps within the window. */
  continuity: 0.12,
  /** Pitches landing on a semitone grid. */
  tuning: 0.08,
} as const;

/** Weight added to the music score by a corroborating provider music event. */
const PROVIDER_HINT_WEIGHT = 0.18;

/**
 * Clamps a value into `[0, 1]`.
 * @param value - Arbitrary number.
 * @returns Value limited to the unit range.
 */
function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Maps a feature onto `[0, 1]` by linear ramp between two reference points.
 * @param value - Feature value.
 * @param zeroAt - Value scoring 0.
 * @param oneAt - Value scoring 1.
 * @returns Normalized score in `[0, 1]`.
 */
function ramp(value: number, zeroAt: number, oneAt: number): number {
  if (oneAt === zeroAt) return 0;
  return clamp01((value - zeroAt) / (oneAt - zeroAt));
}

/**
 * Combines features into a music likelihood.
 * @param features - Per-window features.
 * @returns Music likelihood in `[0, 1]`.
 */
export function musicScoreFromFeatures(features: AudioActivityFeatures): number {
  const slowModulation = ramp(features.syllableRatio, 0.55, 0.25);
  const pitchSustain = ramp(features.pitchSustainRatio, 0.18, 0.5);
  const voicing = ramp(features.voicedRatio, 0.6, 0.85);
  const continuity = ramp(features.lowEnergyRatio, 0.3, 0.12);
  const tuning = ramp(features.semitoneDeviationCents, 22, 10);

  return clamp01(
    slowModulation * WEIGHTS.slowModulation +
      pitchSustain * WEIGHTS.pitchSustain +
      voicing * WEIGHTS.voicing +
      continuity * WEIGHTS.continuity +
      tuning * WEIGHTS.tuning
  );
}

/**
 * A corroborating music signal reported by the upstream ASR provider.
 */
export interface ProviderMusicHint {
  /** True while the provider reports an active music event. */
  active: boolean;
  /** Provider confidence in `[0, 1]`. */
  confidence: number;
}

/**
 * Options for {@link createHeuristicAudioActivityClassifier}.
 */
export interface HeuristicClassifierOptions {
  /** RMS below which a window counts as silence. */
  silenceRms?: number;
  /** Peak below which a window counts as silence. */
  silencePeak?: number;
  /**
   * Supplies the current provider music hint, if any.
   *
   * Speechmatics documents its realtime music events as over-sensitive, so the hint
   * can only nudge a borderline window toward music — it never forces the decision
   * and its absence never argues for speech.
   * @returns Active hint, or null when no fresh hint exists.
   */
  providerHint?: () => ProviderMusicHint | null;
}

/**
 * Creates the dependency-free speech/music classifier.
 * @param options - Silence thresholds and optional provider hint source.
 * @returns Classifier scoring one analysis window at a time.
 */
export function createHeuristicAudioActivityClassifier(
  options: HeuristicClassifierOptions = {}
): AudioActivityClassifier {
  const silenceRms = options.silenceRms ?? ACTIVITY_SILENCE_RMS;
  const silencePeak = options.silencePeak ?? ACTIVITY_SILENCE_PEAK;

  return {
    id: 'heuristic',
    classify(samples: Float32Array, sampleRate: number): AudioActivityScores {
      const features = extractAudioActivityFeatures(samples, sampleRate);
      const silent = features.rms < silenceRms && features.peak < silencePeak;
      if (silent) {
        return { music: 0, speech: 0, silent: true, features };
      }

      let music = musicScoreFromFeatures(features);
      const hint = options.providerHint?.();
      if (hint?.active) {
        music = clamp01(music + PROVIDER_HINT_WEIGHT * clamp01(hint.confidence));
      }

      return { music, speech: 1 - music, silent: false, features };
    },
  };
}
