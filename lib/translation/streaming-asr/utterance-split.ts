// =============================================================================
// Caption-sized utterance splits for streaming ASR adapters
// =============================================================================

/**
 * Soft length at which locked / cumulative transcript should become its own
 * caption/TTS segment when a sentence boundary is available.
 * Aimed at ~one spoken sentence for live listen (not multi-sentence paragraphs).
 */
export const STREAMING_UTTERANCE_SOFT_MAX_CHARS = 100;

/**
 * Hard length — force a break even mid-sentence so captions/TTS cannot grow unbounded.
 */
export const STREAMING_UTTERANCE_HARD_MAX_CHARS = 160;

/**
 * Minimum length before treating a punctuated slice as its own final.
 * Avoids tiny “Yes.” / “Amen.” spam while still flushing real sentences promptly.
 */
export const STREAMING_MIN_SENTENCE_FINAL_CHARS = 40;

/**
 * Takes a caption-sized chunk off oversized transcript when possible.
 * Once past `softMax`, prefers the last complete sentence that still fits in
 * that window so continuous speech becomes short caption/TTS units.
 * @param committed - Transcript awaiting a pause / provider final.
 * @param softMax - Prefer a break once length reaches this.
 * @param hardMax - Always break at/before this length.
 * @returns Chunk to emit as `final` plus remaining text, or null to wait.
 */
export function takeUtteranceChunk(
  committed: string,
  softMax: number = STREAMING_UTTERANCE_SOFT_MAX_CHARS,
  hardMax: number = STREAMING_UTTERANCE_HARD_MAX_CHARS
): { chunk: string; rest: string } | null {
  const text = committed.trim();
  if (text.length < softMax) return null;

  // Only used for forced mid-word fallback — sentence ends may be earlier than softMax/2.
  const minWordBreak = Math.max(12, Math.floor(softMax / 4));

  const isSentenceEnd = (i: number): boolean => {
    const ch = text[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') return false;
    const next = text[i + 1];
    return next === undefined || /\s/.test(next);
  };

  // Prefer the last sentence that still fits inside the soft window.
  let breakAt = -1;
  const softEnd = Math.min(text.length, softMax);
  for (let i = 0; i < softEnd; i += 1) {
    if (isSentenceEnd(i)) breakAt = i + 1;
  }

  // Otherwise take the first sentence end between softMax and hardMax.
  if (breakAt < 0) {
    const hardEnd = Math.min(text.length, hardMax);
    for (let i = softMax; i < hardEnd; i += 1) {
      if (isSentenceEnd(i)) {
        breakAt = i + 1;
        break;
      }
    }
  }

  if (breakAt < 0) {
    if (text.length < hardMax) return null;
    const slice = text.slice(0, hardMax);
    const sp = slice.lastIndexOf(' ');
    breakAt = sp >= minWordBreak ? sp : hardMax;
  }

  const chunk = text.slice(0, breakAt).trim();
  const rest = text.slice(breakAt).trim();
  if (!chunk) return null;
  return { chunk, rest };
}

/**
 * True when text already ends a sentence and is long enough to speak alone.
 * @param text - Transcript candidate.
 * @returns Whether it should flush as its own final.
 */
export function shouldFinalizeCompleteSentence(
  text: string,
  minChars: number = STREAMING_MIN_SENTENCE_FINAL_CHARS
): boolean {
  const trimmed = text.trim();
  if (trimmed.length < minChars) return false;
  return /[.!?]$/.test(trimmed);
}

/**
 * Returns the unfixed suffix of cumulative transcript after text already emitted as finals.
 * When the provider revises earlier wording, falls back to the full text.
 * @param full - Latest cumulative transcript.
 * @param finalizedPrefix - Text already emitted as caption finals.
 * @returns Remaining text to split / show as partial.
 */
export function remainingAfterFinalizedPrefix(full: string, finalizedPrefix: string): string {
  const text = full.trim();
  const prefix = finalizedPrefix.trim();
  if (!prefix) return text;
  if (text.startsWith(prefix)) {
    return text.slice(prefix.length).trim();
  }
  // Soft match: prefix with collapsed whitespace differences.
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const nText = norm(text);
  const nPrefix = norm(prefix);
  if (nText.startsWith(nPrefix)) {
    // Map back approximately by character ratio — prefer exact when possible.
    return nText.slice(nPrefix.length).trim();
  }
  return text;
}

/**
 * Joins finalized caption chunks into the cumulative prefix tracker.
 * @param prefix - Existing finalized prefix.
 * @param chunk - Newly emitted final.
 * @returns Updated prefix.
 */
export function appendFinalizedPrefix(prefix: string, chunk: string): string {
  const a = prefix.trim();
  const b = chunk.trim();
  if (!a) return b;
  if (!b) return a;
  return `${a} ${b}`.trim();
}
