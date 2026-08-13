// =============================================================================
// STT quality gates (silence + Whisper hallucination filters)
// =============================================================================

/**
 * RMS of 16-bit little-endian mono PCM, normalized to ~[0, 1].
 * @param pcm - Raw PCM16 LE mono bytes.
 * @returns Root-mean-square amplitude.
 */
export function pcm16MonoRms(pcm: Buffer): number {
  const sampleCount = Math.floor(pcm.length / 2);
  if (sampleCount <= 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < sampleCount; i += 1) {
    const sample = pcm.readInt16LE(i * 2) / 32768;
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / sampleCount);
}

/**
 * Peak absolute sample of 16-bit little-endian mono PCM, normalized to ~[0, 1].
 * @param pcm - Raw PCM16 LE mono bytes.
 * @returns Peak absolute amplitude.
 */
export function pcm16MonoPeak(pcm: Buffer): number {
  const sampleCount = Math.floor(pcm.length / 2);
  let peak = 0;
  for (let i = 0; i < sampleCount; i += 1) {
    const abs = Math.abs(pcm.readInt16LE(i * 2) / 32768);
    if (abs > peak) peak = abs;
  }
  return peak;
}

/** Default RMS below which a chunk is treated as near-silence (skip STT). */
export const STT_SILENCE_RMS = 0.008;
/** Default peak below which a chunk is treated as near-silence (skip STT). */
export const STT_SILENCE_PEAK = 0.02;

/**
 * True when PCM is too quiet to trust for speech-to-text.
 * Whisper often invents filler (“Thank you”, “Thanks for watching”) on silence/cutoff.
 * @param pcm - Raw PCM16 LE mono bytes.
 * @param options - Optional RMS/peak thresholds.
 * @returns Whether the chunk should be skipped before STT.
 */
export function isNearSilentPcm16(pcm: Buffer, options?: { rms?: number; peak?: number }): boolean {
  if (pcm.length < 2) return true;
  const rmsThreshold = options?.rms ?? STT_SILENCE_RMS;
  const peakThreshold = options?.peak ?? STT_SILENCE_PEAK;
  return pcm16MonoRms(pcm) < rmsThreshold && pcm16MonoPeak(pcm) < peakThreshold;
}

/**
 * Normalizes a transcript for hallucination matching (case/punctuation insensitive).
 * @param text - Raw STT text.
 * @returns Compact lowercase alphanumeric form.
 */
function normalizeForHallucinationMatch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Entire-caption fillers Whisper commonly invents on silence / YouTube-style outros.
 * Only exact matches after normalization are dropped (real “thank you …” in a longer
 * sentence is kept).
 */
const WHISPER_HALLUCINATION_CAPTIONS = new Set(
  [
    '',
    'thank you',
    'thanks',
    'thanks for watching',
    'thank you for watching',
    'thanks for watching please subscribe',
    'thank you for watching please subscribe',
    'please subscribe',
    'subscribe',
    'please like and subscribe',
    'see you next time',
    'bye',
    'goodbye',
    'the end',
    'you',
    'music',
    'applause',
    'laughter',
    'silence',
    '字幕',
    '谢谢',
    '谢谢观看',
    '请不吝点赞',
    '请订阅',
  ].map(normalizeForHallucinationMatch)
);

/**
 * True when the transcript is a repetitive decoder loop (e.g. “Tonshi. Tonshi. …”).
 * @param words - Normalized word tokens.
 * @returns Whether the caption should be discarded.
 */
function hasRepetitiveHallucination(words: string[]): boolean {
  if (words.length < 6) return false;
  let run = 1;
  for (let i = 1; i < words.length; i += 1) {
    if (words[i] === words[i - 1]) {
      run += 1;
      if (run >= 4) return true;
    } else {
      run = 1;
    }
  }
  const unique = new Set(words);
  return words.length >= 10 && unique.size / words.length <= 0.25;
}

/**
 * True when the full transcript looks like a known silence/outro hallucination.
 * @param text - STT transcript.
 * @returns Whether the caption should be discarded.
 */
export function isLikelyWhisperHallucination(text: string): boolean {
  const normalized = normalizeForHallucinationMatch(text);
  if (!normalized) return true;
  if (WHISPER_HALLUCINATION_CAPTIONS.has(normalized)) return true;
  // Single punctuation / ellipsis-only leftovers.
  if (/^[\s.·…•\-–—]+$/u.test(text.trim())) return true;
  // Former prompt leakage / instruction echo (never send prompts to Whisper).
  if (/\btranscri[a-z]*\b.*\bclear speech\b/i.test(normalized)) return true;
  if (/\bonly clear speech\b/i.test(normalized)) return true;
  const words = normalized.split(' ').filter(Boolean);
  if (hasRepetitiveHallucination(words)) return true;
  return false;
}

/**
 * Returns trimmed transcript text, or empty string when it should not be captioned.
 * @param text - Raw STT output.
 * @returns Usable caption text, or empty.
 */
export function sanitizeSttTranscript(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || isLikelyWhisperHallucination(trimmed)) return '';
  return trimmed;
}
