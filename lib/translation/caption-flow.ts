// =============================================================================
// Listener caption flow — finalized text and interim text share one paragraph
// =============================================================================

import { endsCompleteSentence } from '@/lib/translation/streaming-asr/utterance-split';

/**
 * Silence (ms) between caption events that starts a new paragraph.
 *
 * Streaming ASR emits partials continuously while someone is speaking, so a gap this
 * long means a real pause — the only place a paragraph break costs the reader nothing.
 */
export const CAPTION_PARAGRAPH_GAP_MS = 2_500;

/**
 * Length at which a paragraph may end even without a pause.
 * Only applies when the paragraph already ends a sentence, so continuous speech still
 * breaks at a sentence rather than mid-thought.
 */
export const CAPTION_PARAGRAPH_MAX_CHARS = 600;

/** Paragraphs kept in the listener transcript before older ones are dropped. */
export const CAPTION_MAX_BLOCKS = 40;

/**
 * One finalized caption unit inside a paragraph.
 */
export type CaptionSegment = {
  /** Hub segment id; also used to update the row when translation or TTS re-sends it. */
  id: string;
  /** Finalized text for this unit. */
  text: string;
};

/**
 * A rendered paragraph: finalized segments plus the interim tail still being revised.
 */
export type CaptionBlock = {
  /** Stable React key. */
  id: string;
  /** Music markers stand alone; caption paragraphs accumulate speech. */
  kind: 'caption' | 'marker';
  /** Finalized units, in spoken order. */
  segments: CaptionSegment[];
  /** Unfinalized tail rendered inline after the segments (empty when caught up). */
  interim: string;
  /** Creation timestamp. */
  ts: number;
  /** Timestamp of the newest event applied, used for pause detection. */
  updatedAt: number;
};

/**
 * Text a paragraph has already finalized.
 * @param block - Paragraph to read.
 * @returns Finalized segments joined with spaces.
 */
export function captionBlockFinalText(block: CaptionBlock): string {
  return block.segments.map((segment) => segment.text).join(' ');
}

/**
 * Full text a paragraph currently displays, including the interim tail.
 * @param block - Paragraph to read.
 * @returns Finalized text followed by the interim tail.
 */
export function captionBlockText(block: CaptionBlock): string {
  return [captionBlockFinalText(block), block.interim].filter(Boolean).join(' ');
}

/**
 * Total finalized units across all paragraphs.
 * @param blocks - Listener transcript.
 * @returns Number of finalized segments.
 */
export function captionSegmentCount(blocks: CaptionBlock[]): number {
  return blocks.reduce((total, block) => total + block.segments.length, 0);
}

/**
 * Id of the newest finalized unit.
 * @param blocks - Listener transcript.
 * @returns Segment id, or null when nothing has been finalized yet.
 */
export function lastCaptionSegmentId(blocks: CaptionBlock[]): string | null {
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const segments = blocks[i]!.segments;
    if (segments.length > 0) return segments[segments.length - 1]!.id;
  }
  return null;
}

/**
 * Whether anything is on screen yet.
 * @param blocks - Listener transcript.
 * @returns True when any paragraph holds finalized or interim text.
 */
export function hasCaptionContent(blocks: CaptionBlock[]): boolean {
  return blocks.some((block) => block.segments.length > 0 || block.interim.length > 0);
}

/**
 * Normalizes a word for prefix comparison across ASR punctuation revisions.
 * @param word - Raw whitespace-separated token.
 * @returns Lowercased letters/digits only.
 */
function comparableWord(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Removes the text a final just locked from the interim tail.
 *
 * Streaming ASR revises punctuation between the last partial and the final, so the
 * overlap is matched word by word. Keeping the unmatched tail is what stops on-screen
 * words from disappearing and re-appearing when a final lands mid-sentence.
 * @param interim - Interim text currently displayed.
 * @param finalText - Text just finalized.
 * @returns Interim text still ahead of the final, or an empty string when fully covered.
 */
export function stripInterimPrefix(interim: string, finalText: string): string {
  const words = interim.trim().split(/\s+/).filter(Boolean);
  const finalWords = finalText.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || finalWords.length === 0) return '';

  let i = 0;
  while (
    i < words.length &&
    i < finalWords.length &&
    comparableWord(words[i]!) === comparableWord(finalWords[i]!)
  ) {
    i += 1;
  }

  // The interim ran ahead of the final — keep the part the final has not covered.
  if (i === finalWords.length && i < words.length) return words.slice(i).join(' ');
  return '';
}

/**
 * Whether incoming text belongs to a new paragraph rather than the current one.
 * @param last - Newest paragraph, if any.
 * @param now - Arrival timestamp.
 * @param isFinal - Whether the incoming event finalizes text.
 * @returns True when a paragraph break should be inserted first.
 */
function shouldStartNewBlock(
  last: CaptionBlock | undefined,
  now: number,
  isFinal: boolean
): boolean {
  if (!last) return true;
  if (last.kind === 'marker') return true;
  if (now - last.updatedAt >= CAPTION_PARAGRAPH_GAP_MS) return true;
  if (!isFinal) return false;
  const finalText = captionBlockFinalText(last);
  return finalText.length >= CAPTION_PARAGRAPH_MAX_CHARS && endsCompleteSentence(finalText);
}

/**
 * Opens a paragraph, moving any interim tail from the previous one into it.
 *
 * Carrying the tail keeps text that is already on screen from being dropped or shown
 * twice when a paragraph break happens to land while speech is still in flight.
 * @param blocks - Listener transcript.
 * @param input - New paragraph id and timestamps.
 * @returns Transcript with the new paragraph appended.
 */
function openCaptionBlock(
  blocks: CaptionBlock[],
  input: { blockId: string; ts: number; now: number }
): CaptionBlock[] {
  const last = blocks[blocks.length - 1];
  const carried = last && last.kind === 'caption' ? last.interim : '';
  const previous = carried ? [...blocks.slice(0, -1), { ...last!, interim: '' }] : blocks;
  return [
    ...previous,
    {
      id: input.blockId,
      kind: 'caption' as const,
      segments: [],
      interim: carried,
      ts: input.ts,
      updatedAt: input.now,
    },
  ].slice(-CAPTION_MAX_BLOCKS);
}

/**
 * Appends a finalized caption unit to the live paragraph.
 * @param blocks - Listener transcript.
 * @param input - Segment id, finalized text, hub timestamp, arrival time, and a paragraph id to use if one must be opened.
 * @returns Updated transcript.
 */
export function appendCaptionFinal(
  blocks: CaptionBlock[],
  input: { id: string; text: string; ts: number; now: number; blockId: string }
): CaptionBlock[] {
  const text = input.text.trim();
  if (!text) return blocks;

  const base = shouldStartNewBlock(blocks[blocks.length - 1], input.now, true)
    ? openCaptionBlock(blocks, input)
    : blocks;
  const target = base[base.length - 1]!;

  return [
    ...base.slice(0, -1),
    {
      ...target,
      segments: [...target.segments, { id: input.id, text }],
      interim: stripInterimPrefix(target.interim, text),
      updatedAt: input.now,
    },
  ];
}

/**
 * Replaces the interim tail of the live paragraph.
 * @param blocks - Listener transcript.
 * @param input - Interim text, hub timestamp, arrival time, and a paragraph id to use if one must be opened.
 * @returns Updated transcript.
 */
export function applyCaptionInterim(
  blocks: CaptionBlock[],
  input: { text: string; ts: number; now: number; blockId: string }
): CaptionBlock[] {
  const text = input.text.trim();
  if (!text) return blocks;

  const base = shouldStartNewBlock(blocks[blocks.length - 1], input.now, false)
    ? openCaptionBlock(blocks, input)
    : blocks;
  const target = base[base.length - 1]!;

  return [...base.slice(0, -1), { ...target, interim: text, updatedAt: input.now }];
}

/**
 * Appends a standalone music marker paragraph.
 *
 * Any interim tail is dropped: captions stop during music, so unfinalized words would
 * otherwise sit on screen until singing ends.
 * @param blocks - Listener transcript.
 * @param input - Marker id, localized marker text, and timestamp.
 * @returns Updated transcript, unchanged when a marker is already showing.
 */
export function appendCaptionMarker(
  blocks: CaptionBlock[],
  input: { id: string; text: string; ts: number }
): CaptionBlock[] {
  const last = blocks[blocks.length - 1];
  if (last?.kind === 'marker') return blocks;

  const previous = last?.interim ? [...blocks.slice(0, -1), { ...last, interim: '' }] : blocks;
  return [
    ...previous,
    {
      id: input.id,
      kind: 'marker' as const,
      segments: [{ id: input.id, text: input.text }],
      interim: '',
      ts: input.ts,
      updatedAt: input.ts,
    },
  ].slice(-CAPTION_MAX_BLOCKS);
}

/**
 * Rewrites one finalized unit in place, keeping its position in the paragraph.
 *
 * The hub re-sends a segment when its translation or spoken audio is ready.
 * @param blocks - Listener transcript.
 * @param input - Segment id and replacement text.
 * @returns Updated transcript.
 */
export function updateCaptionSegment(
  blocks: CaptionBlock[],
  input: { id: string; text: string }
): CaptionBlock[] {
  const text = input.text.trim();
  if (!text) return blocks;
  return blocks.map((block) =>
    block.segments.some((segment) => segment.id === input.id)
      ? {
          ...block,
          segments: block.segments.map((segment) =>
            segment.id === input.id ? { ...segment, text } : segment
          ),
        }
      : block
  );
}
