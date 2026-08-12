// =============================================================================
// Audio activity detection — shared types
// =============================================================================
// Distinguishes preaching/speech from singing/music on the owner PCM stream so
// captions can be suppressed (and upstream STT paused) during worship music.
// =============================================================================

/**
 * Coarse classification of what the owner audio currently contains.
 *
 * `silence` is deliberately neutral: a pause between hymn verses must not flip
 * the pipeline back to captioning, and a pause mid-sermon must not flip it to music.
 */
export type AudioActivityState = 'speech' | 'music' | 'silence';

/**
 * Per-window acoustic features used to separate speech from singing.
 *
 * All ratios are in `[0, 1]` unless noted. Values are computed over one analysis
 * window (typically 2 s of 16 kHz mono audio).
 */
export interface AudioActivityFeatures {
  /** Root-mean-square amplitude of the window, normalized to ~[0, 1]. */
  rms: number;
  /** Peak absolute amplitude of the window, normalized to ~[0, 1]. */
  peak: number;
  /**
   * Share of amplitude-envelope modulation energy in the 3–8 Hz syllable band
   * versus the 0.5–2.5 Hz note band. High for speech, low for sustained singing.
   */
  syllableRatio: number;
  /** Share of 10 ms frames quieter than half the window mean (speech pauses). */
  lowEnergyRatio: number;
  /** Share of pitch frames judged voiced (periodic). Singing is near-continuous. */
  voicedRatio: number;
  /**
   * Share of pitch frames belonging to a sustained note: a run held within a
   * narrow pitch band for at least the configured minimum duration.
   */
  pitchSustainRatio: number;
  /**
   * Mean distance of voiced pitches from the nearest semitone of the best-fitting
   * tuning grid, in cents (0–25; lower means more musically tuned).
   */
  semitoneDeviationCents: number;
  /** Number of pitch frames analysed in this window. */
  pitchFrameCount: number;
}

/**
 * Likelihood scores for one analysis window.
 */
export interface AudioActivityScores {
  /** Music/singing likelihood in `[0, 1]`. */
  music: number;
  /** Speech likelihood in `[0, 1]` (complement of {@link AudioActivityScores.music}). */
  speech: number;
  /** True when the window is too quiet to classify. */
  silent: boolean;
  /** Features the scores were derived from (useful for calibration and debugging). */
  features: AudioActivityFeatures;
}

/**
 * Pluggable window classifier.
 *
 * The default implementation is signal-processing based and dependency-free. A
 * neural classifier (e.g. YAMNet) can be dropped in behind this interface without
 * touching the detector state machine or the session hub.
 */
export interface AudioActivityClassifier {
  /** Stable identifier reported in logs and calibration output. */
  readonly id: string;
  /**
   * Scores one analysis window.
   * @param samples - Mono samples in `[-1, 1]`, oldest first.
   * @param sampleRate - Sample rate of `samples` in Hz.
   * @returns Music/speech likelihoods plus the underlying features.
   */
  classify(samples: Float32Array, sampleRate: number): AudioActivityScores;
}
