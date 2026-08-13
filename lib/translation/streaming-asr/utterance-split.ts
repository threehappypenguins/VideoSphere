// =============================================================================
// Caption-sized utterance splits for streaming ASR adapters
// =============================================================================

import type { StreamingAsrEvent } from '@/lib/translation/streaming-asr/types';

/**
 * Soft length at which locked / cumulative transcript should become its own
 * caption/TTS segment when a sentence boundary is available.
 * Aimed at ~one spoken sentence for live listen (not multi-sentence paragraphs).
 */
export const STREAMING_UTTERANCE_SOFT_MAX_CHARS = 90;

/**
 * Hard length — force a clause/word break so captions/TTS cannot grow unbounded.
 * Applies on provider finals and on mid-turn partials once no sentence end appears.
 */
export const STREAMING_UTTERANCE_HARD_MAX_CHARS = 140;

/**
 * How far mid-turn partials may search for a sentence end before forcing a hard break.
 * Preaching often run-ons past `hardMax` before the first period lands in the transcript.
 */
export const STREAMING_UTTERANCE_SENTENCE_SEARCH_MAX_CHARS = 200;

/**
 * Minimum length before treating a punctuated slice as its own final.
 * Avoids tiny “Yes.” / “Amen.” spam while still flushing real sentences promptly.
 */
export const STREAMING_MIN_SENTENCE_FINAL_CHARS = 48;

/**
 * Options for {@link takeUtteranceChunk}.
 */
export type TakeUtteranceChunkOptions = {
  /**
   * When false (mid-turn partials), do not lock a lone trailing sentence with no
   * remainder (ASR may still revise it). Hard breaks past `hardMax` still apply so
   * run-ons cannot grow into one multi-paragraph partial.
   * @defaultValue true
   */
  allowHardBreak?: boolean;
  /**
   * How far to search for `.`/`!`/`?` before giving up and forcing a clause break.
   * @defaultValue {@link STREAMING_UTTERANCE_SENTENCE_SEARCH_MAX_CHARS}
   */
  sentenceSearchMax?: number;
};

/**
 * Picks a forced break index preferring clause boundaries, then spaces.
 * @param text - Full pending transcript.
 * @param limit - Max index to break at (exclusive of trailing incomplete crumbs when possible).
 * @param minWordBreak - Refuse breaks earlier than this.
 * @returns Character index to split at.
 */
function findForcedBreakAt(text: string, limit: number, minWordBreak: number): number {
  const end = Math.min(text.length, limit);
  const slice = text.slice(0, end);
  const preferAfter = Math.max(minWordBreak, Math.floor(slice.length * 0.45));

  const tryPattern = (re: RegExp): number => {
    let last = -1;
    let match: RegExpExecArray | null;
    const local = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    while ((match = local.exec(slice)) !== null) {
      const at = match.index + match[0].length;
      if (at >= preferAfter) last = at;
    }
    return last;
  };

  for (const re of [/, /g, /; /g, / — /g, / – /g, / - /g]) {
    const at = tryPattern(re);
    if (at >= minWordBreak) return at;
  }

  const sp = slice.lastIndexOf(' ');
  return sp >= minWordBreak ? sp : end;
}

/**
 * Walks a forced break leftward until the chunk no longer looks truncated.
 * @param text - Full pending transcript.
 * @param breakAt - Initial break index.
 * @param minWordBreak - Refuse breaks earlier than this.
 * @returns Adjusted break index.
 */
function backUpIncompleteBreak(text: string, breakAt: number, minWordBreak: number): number {
  let at = breakAt;
  while (at > minWordBreak) {
    const chunk = text.slice(0, at).trim();
    if (!looksLikeIncompleteCaption(chunk)) return at;
    const prev = text.slice(0, at - 1).lastIndexOf(' ');
    if (prev < minWordBreak) break;
    at = prev;
  }
  return at;
}

/**
 * Takes a caption-sized chunk off oversized transcript when possible.
 * Once past `softMax`, prefers the last complete sentence that still fits in
 * that window so continuous speech becomes short caption/TTS units.
 * @param committed - Transcript awaiting a pause / provider final.
 * @param softMax - Prefer a break once length reaches this.
 * @param hardMax - Force a clause/word break at/before this length when needed.
 * @param options - Partial vs final splitting behavior.
 * @returns Chunk to emit as `final` plus remaining text, or null to wait.
 */
export function takeUtteranceChunk(
  committed: string,
  softMax: number = STREAMING_UTTERANCE_SOFT_MAX_CHARS,
  hardMax: number = STREAMING_UTTERANCE_HARD_MAX_CHARS,
  options: TakeUtteranceChunkOptions = {}
): { chunk: string; rest: string } | null {
  const allowHardBreak = options.allowHardBreak !== false;
  const sentenceSearchMax =
    options.sentenceSearchMax ?? STREAMING_UTTERANCE_SENTENCE_SEARCH_MAX_CHARS;
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

  // Otherwise take the first sentence end after softMax — search past hardMax so
  // mid-turn run-ons still split when the period finally arrives (preaching style).
  if (breakAt < 0) {
    const searchEnd = Math.min(text.length, Math.max(hardMax, sentenceSearchMax));
    for (let i = softMax; i < searchEnd; i += 1) {
      if (isSentenceEnd(i)) {
        breakAt = i + 1;
        break;
      }
    }
  }

  // Still no sentence end — force a clause/word break once past hardMax so the
  // italic partial cannot grow into a multi-paragraph blurb until turn end.
  if (breakAt < 0) {
    if (text.length < hardMax) return null;
    breakAt = findForcedBreakAt(text, hardMax, minWordBreak);
    breakAt = backUpIncompleteBreak(text, breakAt, minWordBreak);
    // If we still look truncated and there is room to wait, keep buffering unless
    // the emergency search window is already exceeded.
    const probe = text.slice(0, breakAt).trim();
    if (looksLikeIncompleteCaption(probe) && text.length < sentenceSearchMax) {
      return null;
    }
  }

  let chunk = text.slice(0, breakAt).trim();
  let rest = text.slice(breakAt).trim();
  if (!chunk) return null;
  if (looksLikeIncompleteCaption(chunk)) {
    // Sentence-end path can still land on “—.” style crumbs; refuse unless final flush.
    if (!allowHardBreak) return null;
    breakAt = backUpIncompleteBreak(text, breakAt, minWordBreak);
    chunk = text.slice(0, breakAt).trim();
    rest = text.slice(breakAt).trim();
    if (!chunk || looksLikeIncompleteCaption(chunk)) return null;
  }
  // On mid-turn partials, only lock a sentence when more speech follows. A lone
  // “complete” sentence is still being revised by streaming ASR — locking it
  // produced short awkward finals that later reappeared in one growing blurb.
  // Forced hard breaks always have rest (or we wait), so they still emit.
  if (!allowHardBreak && !rest) return null;
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
  if (looksLikeIncompleteCaption(trimmed)) return false;
  return /[.!?]$/.test(trimmed);
}

/**
 * True when interim ASR text is not stable enough to lock as a caption final.
 * @param text - Candidate caption chunk.
 * @returns Whether the chunk should stay in the partial buffer.
 */
export function looksLikeIncompleteCaption(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  // Cut-off words / fillers common in streaming ASR before the next revision.
  if (/[—–-]$/.test(trimmed)) return true;
  if (/[,;:]$/.test(trimmed)) return true;
  if (/\b(uh|um|erm)\.?$/i.test(trimmed)) return true;
  return false;
}

/**
 * Strips leading/trailing punctuation for word-level transcript alignment.
 * @param token - A whitespace-separated token from the transcript.
 * @returns Lowercased core word, or empty when the token is punctuation-only.
 */
export function normalizeTranscriptWord(token: string): string {
  return token
    .toLowerCase()
    .replace(/^[^a-z0-9\u00c0-\u024f]+/i, '')
    .replace(/[^a-z0-9\u00c0-\u024f]+$/i, '');
}

/**
 * Light stem so singular/plural ASR revisions still align (verse/verses).
 * @param word - Already-normalized transcript word.
 * @returns Stemmed form for fuzzy comparison.
 */
function stemTranscriptWord(word: string): string {
  if (word.length < 4) return word;
  return word.replace(/(?:'s|s|ed|ing)$/i, '');
}

/**
 * True when two normalized words are the same ASR hypothesis (including light revisions).
 * @param a - Normalized word from the live transcript.
 * @param b - Normalized word from the locked prefix.
 * @returns Whether the tokens should count as aligned.
 */
export function transcriptWordsMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const sa = stemTranscriptWord(a);
  const sb = stemTranscriptWord(b);
  if (sa === sb && sa.length >= 3) return true;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) {
    if (Math.abs(a.length - b.length) <= 2) return true;
  }
  // Common short-function-word revisions from streaming ASR.
  const pair = a < b ? `${a}|${b}` : `${b}|${a}`;
  if (
    pair === 'can|could' ||
    pair === 'will|would' ||
    pair === 'is|was' ||
    pair === 'are|were' ||
    pair === 'this|these' ||
    pair === 'that|those' ||
    pair === 'verse|verses'
  ) {
    return true;
  }
  if (a.length <= 10 && b.length <= 10) {
    return levenshteinDistance(a, b) <= (Math.min(a.length, b.length) <= 4 ? 1 : 2);
  }
  return false;
}

/**
 * Classic Levenshtein distance for short ASR word revisions.
 * @param a - First string.
 * @param b - Second string.
 * @returns Edit distance.
 */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i += 1) {
    let prev = i;
    row[0] = i + 1;
    for (let j = 0; j < b.length; j += 1) {
      const cur = prev;
      prev = row[j + 1]!;
      const cost = a[i] === b[j] ? 0 : 1;
      row[j + 1] = Math.min(prev + 1, row[j]! + 1, cur + cost);
    }
  }
  return row[b.length]!;
}

type WordToken = { raw: string; index: number };

/**
 * Tokenizes transcript text into non-whitespace spans with offsets.
 * @param text - Transcript string.
 * @returns Tokens with start indexes into `text`.
 */
function tokenizeTranscriptWords(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  const re = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    tokens.push({ raw: match[0]!, index: match.index });
  }
  return tokens;
}

/**
 * Meaningful (non-punctuation) normalized words from a transcript.
 * @param text - Transcript string.
 * @returns Normalized content words.
 */
function contentWords(text: string): string[] {
  return tokenizeTranscriptWords(text)
    .map((t) => normalizeTranscriptWord(t.raw))
    .filter(Boolean);
}

/**
 * Fraction of `prefixWords` that align in order inside `fullWords` with fuzzy matching.
 * @param prefixWords - Locked prefix content words.
 * @param fullWords - Live transcript content words.
 * @returns Overlap ratio in `[0, 1]`.
 */
function orderedOverlapRatio(prefixWords: string[], fullWords: string[]): number {
  if (prefixWords.length === 0) return 1;
  let fi = 0;
  let matched = 0;
  for (const p of prefixWords) {
    while (fi < fullWords.length && !transcriptWordsMatch(fullWords[fi]!, p)) {
      fi += 1;
    }
    if (fi >= fullWords.length) break;
    matched += 1;
    fi += 1;
  }
  return matched / prefixWords.length;
}

/**
 * How many locked prefix content-words were dropped from the live opener, if any.
 * @param prefixWords - Locked prefix content words.
 * @param fullWords - Live transcript content words.
 * @returns Skip count when the live text resumes mid-prefix; otherwise -1.
 */
function leadingPrefixSkipCount(prefixWords: string[], fullWords: string[]): number {
  if (prefixWords.length === 0 || fullWords.length === 0) return -1;
  const maxSkip = Math.min(8, prefixWords.length - 1);
  for (let skip = 0; skip <= maxSkip; skip += 1) {
    if (!transcriptWordsMatch(fullWords[0]!, prefixWords[skip]!)) continue;
    if (orderedOverlapRatio(prefixWords.slice(skip), fullWords) >= 0.75) return skip;
  }
  return -1;
}

/**
 * Aligns locked prefix words onto the live transcript, allowing a few ASR slips.
 * @param fullWords - Tokenized live transcript.
 * @param prefixWords - Tokenized locked prefix.
 * @returns Index after the last aligned live token, or null when alignment fails.
 */
function alignPrefixOntoFull(fullWords: WordToken[], prefixWords: WordToken[]): number | null {
  let fi = 0;
  let slips = 0;
  const prefixNorm = prefixWords.map((t) => normalizeTranscriptWord(t.raw));
  const prefixContent = prefixNorm.filter(Boolean);
  const fullContent = fullWords.map((t) => normalizeTranscriptWord(t.raw)).filter(Boolean);
  const maxSlips = Math.max(2, Math.ceil(prefixContent.length * 0.25));

  // Live often drops a leading clause (“Verse 13 to 25.”) while keeping the rest.
  const leadSkip = leadingPrefixSkipCount(prefixContent, fullContent);
  let pi = 0;
  if (leadSkip > 0) {
    let skipped = 0;
    while (pi < prefixNorm.length && skipped < leadSkip) {
      if (prefixNorm[pi]) skipped += 1;
      pi += 1;
    }
    slips += 1;
  }

  for (; pi < prefixWords.length; pi += 1) {
    const pWord = prefixNorm[pi]!;
    if (!pWord) continue;

    while (fi < fullWords.length && !normalizeTranscriptWord(fullWords[fi]!.raw)) {
      fi += 1;
    }
    if (fi >= fullWords.length) {
      return slips <= maxSlips ? fullWords.length : null;
    }

    const fWord = normalizeTranscriptWord(fullWords[fi]!.raw);
    if (transcriptWordsMatch(fWord, pWord)) {
      fi += 1;
      continue;
    }

    // ASR inserted a word in the live transcript.
    if (slips < maxSlips && fi + 1 < fullWords.length) {
      const next = normalizeTranscriptWord(fullWords[fi + 1]!.raw);
      if (next && transcriptWordsMatch(next, pWord)) {
        fi += 2;
        slips += 1;
        continue;
      }
    }

    // ASR dropped a locked word (e.g. “Verse” → “13 to 25…”).
    if (slips < maxSlips) {
      let nextPrefix: string | null = null;
      for (let pj = pi + 1; pj < prefixNorm.length; pj += 1) {
        if (prefixNorm[pj]) {
          nextPrefix = prefixNorm[pj]!;
          break;
        }
      }
      if (nextPrefix && transcriptWordsMatch(fWord, nextPrefix)) {
        slips += 1;
        continue; // skip this prefix word; retry next pi against same fi
      }
    }

    // Substitution (can→could already matched above; residual wording edits).
    if (slips < maxSlips) {
      fi += 1;
      slips += 1;
      continue;
    }

    return null;
  }

  return fi;
}

/**
 * Result of peeling already-emitted caption text off a cumulative transcript.
 */
export type CumulativePrefixMatch = {
  /** Text after the matched prefix (may be empty). */
  remaining: string;
  /**
   * How the prefix was matched.
   * `none` means the provider revised too hard to align — callers must not
   * re-emit the whole transcript as new finals.
   */
  match: 'exact' | 'normalized' | 'words' | 'none';
};

/**
 * Returns the unfixed suffix of cumulative transcript after text already emitted as finals.
 *
 * Providers (especially AssemblyAI with `format_turns`) revise punctuation and
 * mid-turn wording — e.g. finalized `…David.` then cumulative `…David had…`.
 * Word-level alignment keeps those revisions from re-emitting earlier captions.
 * @param full - Latest cumulative transcript.
 * @param finalizedPrefix - Text already emitted as caption finals.
 * @returns Remaining text plus how the prefix was matched.
 */
export function remainingAfterFinalizedPrefix(
  full: string,
  finalizedPrefix: string
): CumulativePrefixMatch {
  const text = full.trim();
  const prefix = finalizedPrefix.trim();
  if (!prefix) return { remaining: text, match: 'exact' };
  if (text.startsWith(prefix)) {
    return { remaining: text.slice(prefix.length).trim(), match: 'exact' };
  }

  const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
  const nText = collapse(text);
  const nPrefix = collapse(prefix);
  if (nText.startsWith(nPrefix)) {
    return { remaining: nText.slice(nPrefix.length).trim(), match: 'normalized' };
  }

  // Punctuation / casing / light wording revisions: fuzzy word alignment.
  const fullWords = tokenizeTranscriptWords(text);
  const prefixWords = tokenizeTranscriptWords(prefix);
  const alignedFi = alignPrefixOntoFull(fullWords, prefixWords);
  if (alignedFi === null) {
    return { remaining: text, match: 'none' };
  }
  if (alignedFi === 0) {
    return { remaining: text, match: 'none' };
  }
  if (alignedFi >= fullWords.length) {
    return { remaining: '', match: 'words' };
  }
  const last = fullWords[alignedFi - 1]!;
  return {
    remaining: text.slice(last.index + last.raw.length).trim(),
    match: 'words',
  };
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

/**
 * True when a candidate final largely repeats text already locked in the prefix.
 * @param prefix - Text already emitted as finals.
 * @param chunk - Candidate final chunk.
 * @returns Whether the chunk should be suppressed as a near-duplicate.
 */
export function isNearDuplicateCaption(prefix: string, chunk: string): boolean {
  const p = contentWords(prefix);
  const c = contentWords(chunk);
  if (c.length === 0) return true;
  if (p.length === 0) return false;
  // Chunk is almost entirely already present (in order) inside the locked prefix.
  if (orderedOverlapRatio(c, p) >= 0.85) return true;
  // Prefix already ends with this chunk's wording.
  const tail = p.slice(-c.length);
  if (tail.length === c.length) {
    let same = 0;
    for (let i = 0; i < c.length; i += 1) {
      if (transcriptWordsMatch(tail[i]!, c[i]!)) same += 1;
    }
    if (same / c.length >= 0.85) return true;
  }
  return false;
}

/**
 * Soft-splits `pending` into caption finals (and an optional trailing partial).
 * @param pending - Text not yet locked as finals.
 * @param kind - Whether this is a provider final (flush remainder) or partial.
 * @param sourceLanguage - Language metadata for hub events.
 * @param finalizedPrefix - Prefix tracker to extend as finals emit.
 * @returns Updated prefix, events, and any leftover pending (empty on final).
 */
function emitSoftSplitFromPending(
  pending: string,
  kind: 'partial' | 'final',
  sourceLanguage: string,
  finalizedPrefix: string
): { finalizedPrefix: string; events: StreamingAsrEvent[]; pending: string } {
  let prefix = finalizedPrefix;
  let rest = pending.trim();
  const events: StreamingAsrEvent[] = [];
  const allowHardBreak = kind === 'final';

  const emitFinal = (chunk: string) => {
    const trimmed = chunk.trim();
    if (!trimmed) return;
    if (isNearDuplicateCaption(prefix, trimmed)) {
      // Already spoken — do not re-broadcast, and do not append again (avoids doubling).
      return;
    }
    events.push({ kind: 'final', text: trimmed, language: sourceLanguage });
    prefix = appendFinalizedPrefix(prefix, trimmed);
  };

  for (;;) {
    const split = takeUtteranceChunk(
      rest,
      STREAMING_UTTERANCE_SOFT_MAX_CHARS,
      STREAMING_UTTERANCE_HARD_MAX_CHARS,
      { allowHardBreak }
    );
    if (!split) break;
    emitFinal(split.chunk);
    rest = split.rest;
  }

  if (kind === 'final') {
    if (rest) emitFinal(rest);
    return { finalizedPrefix: '', events, pending: '' };
  }

  // Do not eagerly finalize short “complete” sentences on partials — interim ASR
  // often puts a premature period mid-thought, which produced broken blurbs that
  // later reappeared inside one growing partial.

  if (rest) {
    events.push({ kind: 'partial', text: rest, language: sourceLanguage });
  }

  return { finalizedPrefix: prefix, events, pending: rest };
}

/**
 * True when `full` looks like a new utterance rather than a revision of `prefix`
 * (e.g. AssemblyAI advanced to the next `turn_order`).
 * @param full - Latest cumulative transcript.
 * @param prefix - Text already emitted as finals.
 * @returns Whether callers should clear the prefix and soft-split from scratch.
 */
export function isLikelyNewCumulativeUtterance(full: string, prefix: string): boolean {
  const fullWords = contentWords(full);
  const prefixWords = contentWords(prefix);
  if (fullWords.length === 0 || prefixWords.length === 0) return true;

  // Fuzzy align succeeds ⇒ same turn with wording revisions (Verse→Verses, can→could).
  if (
    alignPrefixOntoFull(tokenizeTranscriptWords(full), tokenizeTranscriptWords(prefix)) !== null
  ) {
    return false;
  }

  // Live resumed mid-prefix after dropping a leading clause.
  if (leadingPrefixSkipCount(prefixWords, fullWords) >= 0) return false;

  return true;
}

/**
 * Soft-splits a growing cumulative transcript into caption-sized hub events.
 *
 * Used by providers that stream one long turn (Modulate, AssemblyAI `format_turns`)
 * without usable mid-turn endpointing. Finalizes sentence-sized chunks from the
 * growing text and flushes any remainder on the provider final.
 * @param input - Latest frame kind/text plus text already emitted as finals.
 * @returns Updated finalized prefix and zero or more hub events (in order).
 */
export function applyCumulativeUtteranceTranscript(input: {
  kind: 'partial' | 'final';
  text: string;
  finalizedPrefix: string;
  sourceLanguage: string;
}): { finalizedPrefix: string; events: StreamingAsrEvent[] } {
  const full = input.text.trim();
  if (!full) {
    return { finalizedPrefix: input.kind === 'final' ? '' : input.finalizedPrefix, events: [] };
  }

  let finalizedPrefix = input.finalizedPrefix.trim();
  const peeled = remainingAfterFinalizedPrefix(full, finalizedPrefix);

  if (peeled.match === 'none' && finalizedPrefix) {
    if (isLikelyNewCumulativeUtterance(full, finalizedPrefix)) {
      // New AssemblyAI turn (or unrelated utterance): drop the old lock and split fresh.
      return emitSoftSplitFromPending(full, input.kind, input.sourceLanguage, '');
    }

    // Same-turn revision we could not peel precisely — adopt live wording for the
    // overlapping span and only soft-split truly new tail text (never re-emit).
    const prefixWords = contentWords(finalizedPrefix);
    const fullTokens = tokenizeTranscriptWords(full);
    const fullContent = fullTokens
      .map((t) => ({ token: t, word: normalizeTranscriptWord(t.raw) }))
      .filter((t) => t.word);
    let matched = 0;
    let fi = 0;
    for (const p of prefixWords) {
      while (fi < fullContent.length && !transcriptWordsMatch(fullContent[fi]!.word, p)) {
        fi += 1;
      }
      if (fi >= fullContent.length) break;
      matched += 1;
      fi += 1;
    }
    if (matched === 0) {
      return {
        finalizedPrefix: input.kind === 'final' ? '' : finalizedPrefix,
        events: [],
      };
    }
    const last = fullContent[Math.min(fi, fullContent.length) - 1]!;
    const livePrefix = full.slice(0, last.token.index + last.token.raw.length).trim();
    const toSplit = full.slice(last.token.index + last.token.raw.length).trim();
    if (!toSplit) {
      return {
        finalizedPrefix: input.kind === 'final' ? '' : livePrefix || finalizedPrefix,
        events: [],
      };
    }
    return emitSoftSplitFromPending(
      toSplit,
      input.kind,
      input.sourceLanguage,
      input.kind === 'final' ? '' : livePrefix || finalizedPrefix
    );
  }

  const pending = peeled.remaining;
  // When word-aligned, prefer live wording for punctuation — but never shrink the
  // lock when ASR temporarily drops a leading clause (Verse 13…), or that clause
  // coming back looks like a brand-new caption.
  if (peeled.match === 'words' && finalizedPrefix) {
    const consumedLen = full.length - pending.length;
    const livePrefix = full.slice(0, Math.max(0, consumedLen)).trim();
    if (
      livePrefix &&
      contentWords(livePrefix).length >= Math.floor(contentWords(finalizedPrefix).length * 0.85)
    ) {
      finalizedPrefix = livePrefix;
    }
  }

  return emitSoftSplitFromPending(pending, input.kind, input.sourceLanguage, finalizedPrefix);
}
