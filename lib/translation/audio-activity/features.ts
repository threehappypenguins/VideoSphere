// =============================================================================
// Audio activity detection — signal-processing feature extraction
// =============================================================================
// Deliberately dependency-free so it runs on Alpine/musl and arm64 without any
// native binaries. Feature choices follow the classic speech/music discrimination
// literature (envelope modulation, low-energy ratio) plus pitch-behaviour features
// that also separate *unaccompanied* singing from speech, which instrument-oriented
// detectors cannot do.
// =============================================================================

import type { AudioActivityFeatures } from '@/lib/translation/audio-activity/types';

/** Envelope frame length in milliseconds (amplitude envelope sample period). */
const ENVELOPE_FRAME_MS = 10;
/** Lower edge of the "note rate" modulation band in Hz. */
const NOTE_BAND_LOW_HZ = 0.5;
/** Upper edge of the "note rate" modulation band in Hz. */
const NOTE_BAND_HIGH_HZ = 2.5;
/** Lower edge of the syllable-rate modulation band in Hz. */
const SYLLABLE_BAND_LOW_HZ = 3;
/** Upper edge of the syllable-rate modulation band in Hz. */
const SYLLABLE_BAND_HIGH_HZ = 8;
/** Modulation spectrum resolution in Hz. */
const MODULATION_STEP_HZ = 0.25;

/** Sample rate used for pitch analysis; 8 kHz is ample for f0 below 600 Hz. */
const PITCH_SAMPLE_RATE = 8000;
/** Pitch analysis frame length in milliseconds. */
const PITCH_FRAME_MS = 40;
/** Pitch analysis hop in milliseconds. */
const PITCH_HOP_MS = 20;
/** Lowest pitch tracked in Hz (low male speaking/singing voice). */
const PITCH_MIN_HZ = 70;
/** Highest pitch tracked in Hz (congregational soprano range). */
const PITCH_MAX_HZ = 600;
/** Normalized autocorrelation above which a frame counts as voiced. */
const VOICED_CORRELATION = 0.45;
/** Maximum frame-to-frame pitch change, in cents, within one sustained note. */
const SUSTAIN_STEP_CENTS = 30;
/** Maximum total pitch span, in cents, across one sustained note. */
const SUSTAIN_SPAN_CENTS = 70;
/** Minimum duration in milliseconds for a pitch run to count as a sustained note. */
const SUSTAIN_MIN_MS = 180;
/** Reference frequency for cent conversion (A1). */
const CENTS_REFERENCE_HZ = 55;

/**
 * Converts interleaved-free PCM16 LE mono bytes to normalized float samples.
 * @param pcm - Raw PCM16 LE mono buffer.
 * @returns Samples in `[-1, 1]`.
 */
export function pcm16ToFloat32(pcm: Buffer): Float32Array {
  const count = Math.floor(pcm.length / 2);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    out[i] = pcm.readInt16LE(i * 2) / 32768;
  }
  return out;
}

/**
 * Resamples mono audio with linear interpolation.
 *
 * Only used when an ingest source deviates from the pipeline's 16 kHz contract.
 * @param samples - Input samples in `[-1, 1]`.
 * @param fromRate - Input sample rate in Hz.
 * @param toRate - Desired sample rate in Hz.
 * @returns Resampled samples, or the input when the rates already match.
 */
export function resampleMono(
  samples: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (fromRate === toRate || fromRate <= 0 || toRate <= 0 || samples.length === 0) {
    return samples;
  }
  const ratio = toRate / fromRate;
  const outLength = Math.max(1, Math.floor(samples.length * ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const src = i / ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(samples.length - 1, i0 + 1);
    const frac = src - i0;
    out[i] = (samples[i0] ?? 0) * (1 - frac) + (samples[i1] ?? 0) * frac;
  }
  return out;
}

/**
 * Root-mean-square amplitude.
 * @param samples - Samples in `[-1, 1]`.
 * @returns RMS amplitude.
 */
function rmsOf(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i]!;
    sum += s * s;
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Peak absolute amplitude.
 * @param samples - Samples in `[-1, 1]`.
 * @returns Peak amplitude.
 */
function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const abs = Math.abs(samples[i]!);
    if (abs > peak) peak = abs;
  }
  return peak;
}

/**
 * Builds the short-term amplitude envelope used for modulation analysis.
 * @param samples - Samples in `[-1, 1]`.
 * @param sampleRate - Sample rate in Hz.
 * @returns Envelope amplitudes sampled every {@link ENVELOPE_FRAME_MS} milliseconds.
 */
function amplitudeEnvelope(samples: Float32Array, sampleRate: number): Float32Array {
  const frame = Math.max(1, Math.round((sampleRate * ENVELOPE_FRAME_MS) / 1000));
  const frames = Math.floor(samples.length / frame);
  const out = new Float32Array(Math.max(0, frames));
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    const start = f * frame;
    for (let i = 0; i < frame; i += 1) {
      const s = samples[start + i]!;
      sum += s * s;
    }
    out[f] = Math.sqrt(sum / frame);
  }
  return out;
}

/**
 * Magnitude of one modulation frequency via a direct (Goertzel-style) DFT bin.
 * @param envelope - Mean-removed, windowed envelope.
 * @param hz - Modulation frequency in Hz.
 * @param envelopeRate - Envelope sample rate in Hz.
 * @returns Bin magnitude.
 */
function modulationMagnitude(envelope: Float32Array, hz: number, envelopeRate: number): number {
  const omega = (2 * Math.PI * hz) / envelopeRate;
  let re = 0;
  let im = 0;
  for (let n = 0; n < envelope.length; n += 1) {
    const v = envelope[n]!;
    re += v * Math.cos(omega * n);
    im -= v * Math.sin(omega * n);
  }
  return Math.sqrt(re * re + im * im);
}

/**
 * Splits envelope modulation energy into syllable-rate and note-rate bands.
 *
 * Speech carries most of its envelope modulation at the 3–8 Hz syllable rate;
 * sung phrases sit far lower because notes are held.
 * @param envelope - Amplitude envelope.
 * @returns Share of banded modulation energy in the syllable band, in `[0, 1]`.
 */
function syllableModulationRatio(envelope: Float32Array): number {
  if (envelope.length < 8) return 0.5;
  const envelopeRate = 1000 / ENVELOPE_FRAME_MS;

  let mean = 0;
  for (let i = 0; i < envelope.length; i += 1) mean += envelope[i]!;
  mean /= envelope.length;

  const windowed = new Float32Array(envelope.length);
  for (let i = 0; i < envelope.length; i += 1) {
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (envelope.length - 1));
    windowed[i] = (envelope[i]! - mean) * hann;
  }

  let noteEnergy = 0;
  let syllableEnergy = 0;
  for (let hz = NOTE_BAND_LOW_HZ; hz <= SYLLABLE_BAND_HIGH_HZ + 1e-9; hz += MODULATION_STEP_HZ) {
    const magnitude = modulationMagnitude(windowed, hz, envelopeRate);
    const energy = magnitude * magnitude;
    if (hz <= NOTE_BAND_HIGH_HZ) {
      noteEnergy += energy;
    } else if (hz >= SYLLABLE_BAND_LOW_HZ) {
      syllableEnergy += energy;
    }
  }

  const total = noteEnergy + syllableEnergy;
  if (total <= 0) return 0.5;
  return syllableEnergy / total;
}

/**
 * Share of envelope frames quieter than half the window mean.
 *
 * Speech is punctuated by stops and breaths; sustained singing is not.
 * @param envelope - Amplitude envelope.
 * @returns Low-energy frame share in `[0, 1]`.
 */
function lowEnergyRatio(envelope: Float32Array): number {
  if (envelope.length === 0) return 0;
  let mean = 0;
  for (let i = 0; i < envelope.length; i += 1) mean += envelope[i]!;
  mean /= envelope.length;
  if (mean <= 0) return 1;
  let low = 0;
  for (let i = 0; i < envelope.length; i += 1) {
    if (envelope[i]! < mean * 0.5) low += 1;
  }
  return low / envelope.length;
}

/**
 * Halves the sample rate with a 3-tap low-pass to limit aliasing before pitch analysis.
 * @param samples - Samples in `[-1, 1]`.
 * @returns Decimated samples at half the input rate.
 */
function decimateByTwo(samples: Float32Array): Float32Array {
  const outLength = Math.floor(samples.length / 2);
  const out = new Float32Array(Math.max(0, outLength));
  for (let i = 0; i < outLength; i += 1) {
    const c = i * 2;
    const prev = samples[c - 1] ?? samples[c] ?? 0;
    const cur = samples[c] ?? 0;
    const next = samples[c + 1] ?? cur;
    out[i] = 0.25 * prev + 0.5 * cur + 0.25 * next;
  }
  return out;
}

/**
 * Converts a frequency to cents above {@link CENTS_REFERENCE_HZ}.
 * @param hz - Frequency in Hz.
 * @returns Pitch in cents.
 */
function hzToCents(hz: number): number {
  return 1200 * Math.log2(hz / CENTS_REFERENCE_HZ);
}

/**
 * Fraction of the strongest correlation a shorter-lag peak must reach to be preferred.
 *
 * Sustained tones correlate just as well at two or three times the true period, so
 * taking the global maximum yields octave errors. Those errors jump between frames
 * and would destroy the sustained-note measurement, so the earliest strong peak wins.
 */
const OCTAVE_PREFERENCE = 0.85;

/**
 * Estimates the fundamental frequency of one frame by normalized autocorrelation.
 * @param frame - Frame samples in `[-1, 1]`.
 * @param sampleRate - Frame sample rate in Hz.
 * @returns Pitch in Hz, or 0 when the frame is unvoiced.
 */
function estimateFramePitch(frame: Float32Array, sampleRate: number): number {
  const minLag = Math.max(2, Math.floor(sampleRate / PITCH_MAX_HZ));
  const maxLag = Math.min(frame.length - 2, Math.ceil(sampleRate / PITCH_MIN_HZ));
  if (maxLag <= minLag) return 0;

  // Remove DC before correlating: any constant offset correlates perfectly at every
  // lag, which would otherwise read as a perfectly held note.
  let mean = 0;
  for (let i = 0; i < frame.length; i += 1) mean += frame[i]!;
  mean /= frame.length;
  const centered = new Float32Array(frame.length);
  for (let i = 0; i < frame.length; i += 1) centered[i] = frame[i]! - mean;

  const scores = new Float32Array(maxLag - minLag + 1);
  let bestScore = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const span = centered.length - lag;
    if (span <= 0) break;
    let corr = 0;
    let energyA = 0;
    let energyB = 0;
    for (let n = 0; n < span; n += 1) {
      const a = centered[n]!;
      const b = centered[n + lag]!;
      corr += a * b;
      energyA += a * a;
      energyB += b * b;
    }
    const denom = Math.sqrt(energyA * energyB);
    const score = denom > 0 ? corr / denom : 0;
    scores[lag - minLag] = score;
    if (score > bestScore) bestScore = score;
  }

  if (bestScore < VOICED_CORRELATION) return 0;

  let chosen = -1;
  const cutoff = bestScore * OCTAVE_PREFERENCE;
  for (let i = 1; i < scores.length - 1; i += 1) {
    const score = scores[i]!;
    if (score < cutoff) continue;
    if (score >= scores[i - 1]! && score >= scores[i + 1]!) {
      chosen = i;
      break;
    }
  }
  if (chosen < 0) {
    for (let i = 0; i < scores.length; i += 1) {
      if (scores[i] === bestScore) {
        chosen = i;
        break;
      }
    }
  }
  if (chosen <= 0 || chosen >= scores.length - 1) {
    const hz = sampleRate / (chosen + minLag);
    return hz >= PITCH_MIN_HZ && hz <= PITCH_MAX_HZ ? hz : 0;
  }

  // Parabolic interpolation around the peak keeps cent-level accuracy, which the
  // semitone-adherence and sustained-note features depend on.
  const before = scores[chosen - 1]!;
  const peak = scores[chosen]!;
  const after = scores[chosen + 1]!;
  const denom = before - 2 * peak + after;
  const shift = denom !== 0 ? (0.5 * (before - after)) / denom : 0;
  const refinedLag = chosen + minLag + Math.max(-0.5, Math.min(0.5, shift));
  const hz = sampleRate / refinedLag;
  if (hz < PITCH_MIN_HZ || hz > PITCH_MAX_HZ) return 0;
  return hz;
}

/**
 * Pitch-track statistics separating held notes from continuously gliding speech.
 * @param samples - Samples in `[-1, 1]` at {@link PITCH_SAMPLE_RATE}.
 * @returns Voiced share, sustained-note share, tuning deviation, and frame count.
 */
function pitchFeatures(samples: Float32Array): {
  voicedRatio: number;
  pitchSustainRatio: number;
  semitoneDeviationCents: number;
  pitchFrameCount: number;
} {
  const frameLength = Math.round((PITCH_SAMPLE_RATE * PITCH_FRAME_MS) / 1000);
  const hop = Math.round((PITCH_SAMPLE_RATE * PITCH_HOP_MS) / 1000);
  const frameCount = Math.floor((samples.length - frameLength) / hop) + 1;
  if (frameCount <= 0) {
    return {
      voicedRatio: 0,
      pitchSustainRatio: 0,
      semitoneDeviationCents: 25,
      pitchFrameCount: 0,
    };
  }

  const cents: Array<number | null> = [];
  for (let f = 0; f < frameCount; f += 1) {
    const start = f * hop;
    const frame = samples.subarray(start, start + frameLength);
    const hz = estimateFramePitch(frame, PITCH_SAMPLE_RATE);
    cents.push(hz > 0 ? hzToCents(hz) : null);
  }

  const voicedCents = cents.filter((c): c is number => c !== null);
  const voicedRatio = voicedCents.length / frameCount;

  // Sustained notes: contiguous voiced runs held inside a narrow pitch band.
  const minRunFrames = Math.max(2, Math.round(SUSTAIN_MIN_MS / PITCH_HOP_MS));
  let sustainedFrames = 0;
  let runStart = -1;
  let runMin = 0;
  let runMax = 0;

  const closeRun = (endExclusive: number): void => {
    if (runStart < 0) return;
    const length = endExclusive - runStart;
    if (length >= minRunFrames) sustainedFrames += length;
    runStart = -1;
  };

  for (let i = 0; i < cents.length; i += 1) {
    const value = cents[i];
    if (value === null || value === undefined) {
      closeRun(i);
      continue;
    }
    if (runStart < 0) {
      runStart = i;
      runMin = value;
      runMax = value;
      continue;
    }
    const previous = cents[i - 1];
    const step =
      previous === null || previous === undefined ? Infinity : Math.abs(value - previous);
    const nextMin = Math.min(runMin, value);
    const nextMax = Math.max(runMax, value);
    if (step > SUSTAIN_STEP_CENTS || nextMax - nextMin > SUSTAIN_SPAN_CENTS) {
      closeRun(i);
      runStart = i;
      runMin = value;
      runMax = value;
      continue;
    }
    runMin = nextMin;
    runMax = nextMax;
  }
  closeRun(cents.length);

  // Tuning adherence: best-fitting semitone grid offset, then mean distance to it.
  let semitoneDeviationCents = 25;
  if (voicedCents.length >= 4) {
    let best = Infinity;
    for (let offset = 0; offset < 100; offset += 4) {
      let total = 0;
      for (const value of voicedCents) {
        const mod = (((value - offset) % 100) + 100) % 100;
        total += Math.min(mod, 100 - mod);
      }
      const mean = total / voicedCents.length;
      if (mean < best) best = mean;
    }
    semitoneDeviationCents = best;
  }

  return {
    voicedRatio,
    pitchSustainRatio: sustainedFrames / frameCount,
    semitoneDeviationCents,
    pitchFrameCount: frameCount,
  };
}

/**
 * Extracts all speech-versus-music features for one analysis window.
 * @param samples - Mono samples in `[-1, 1]`, oldest first.
 * @param sampleRate - Sample rate of `samples` in Hz.
 * @returns Feature set for the window.
 */
export function extractAudioActivityFeatures(
  samples: Float32Array,
  sampleRate: number
): AudioActivityFeatures {
  const envelope = amplitudeEnvelope(samples, sampleRate);

  // 16 kHz is the pipeline contract, so the cheap decimate-by-two path is the norm.
  const pitchInput =
    sampleRate === PITCH_SAMPLE_RATE
      ? samples
      : sampleRate === PITCH_SAMPLE_RATE * 2
        ? decimateByTwo(samples)
        : resampleMono(samples, sampleRate, PITCH_SAMPLE_RATE);

  const pitch = pitchFeatures(pitchInput);

  return {
    rms: rmsOf(samples),
    peak: peakOf(samples),
    syllableRatio: syllableModulationRatio(envelope),
    lowEnergyRatio: lowEnergyRatio(envelope),
    voicedRatio: pitch.voicedRatio,
    pitchSustainRatio: pitch.pitchSustainRatio,
    semitoneDeviationCents: pitch.semitoneDeviationCents,
    pitchFrameCount: pitch.pitchFrameCount,
  };
}
