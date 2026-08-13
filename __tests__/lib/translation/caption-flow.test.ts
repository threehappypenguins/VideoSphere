import { describe, expect, it } from 'vitest';
import {
  CAPTION_PARAGRAPH_GAP_MS,
  appendCaptionFinal,
  appendCaptionMarker,
  applyCaptionInterim,
  captionBlockText,
  captionSegmentCount,
  lastCaptionSegmentId,
  stripInterimPrefix,
  updateCaptionSegment,
  type CaptionBlock,
} from '@/lib/translation/caption-flow';

/** Convenience wrapper so tests read as a stream of hub events at a fixed clock. */
function stream(
  events: Array<
    | { kind: 'final'; id: string; text: string; at: number }
    | { kind: 'interim'; text: string; at: number }
  >
): CaptionBlock[] {
  let blocks: CaptionBlock[] = [];
  for (const event of events) {
    blocks =
      event.kind === 'final'
        ? appendCaptionFinal(blocks, {
            id: event.id,
            text: event.text,
            ts: event.at,
            now: event.at,
            blockId: `blk-${event.at}`,
          })
        : applyCaptionInterim(blocks, {
            text: event.text,
            ts: event.at,
            now: event.at,
            blockId: `blk-${event.at}`,
          });
  }
  return blocks;
}

describe('stripInterimPrefix', () => {
  it('keeps the tail the final has not covered yet', () => {
    expect(
      stripInterimPrefix(
        "Isn't that wonderful? He was honored that this guy",
        "Isn't that wonderful?"
      )
    ).toBe('He was honored that this guy');
  });

  it('tolerates punctuation revisions between the last partial and the final', () => {
    expect(stripInterimPrefix('isnt that wonderful he was honored', "Isn't that wonderful?")).toBe(
      'he was honored'
    );
  });

  it('clears the interim when the final already covers it', () => {
    expect(stripInterimPrefix('He was honored', 'He was honored that this guy asked.')).toBe('');
  });
});

describe('caption paragraph flow', () => {
  it('keeps a finalized sentence and the speech after it in one paragraph', () => {
    const blocks = stream([
      { kind: 'interim', text: "Isn't that wonderful? He was honored that this guy", at: 1_000 },
      { kind: 'final', id: 'seg-1', text: "Isn't that wonderful?", at: 1_200 },
      { kind: 'interim', text: 'He was honored that this guy would ask him', at: 1_400 },
    ]);

    // One paragraph — finalizing must not move the rest of the sentence to a new line.
    expect(blocks).toHaveLength(1);
    expect(captionBlockText(blocks[0]!)).toBe(
      "Isn't that wonderful? He was honored that this guy would ask him"
    );
    expect(blocks[0]!.segments.map((segment) => segment.text)).toEqual(["Isn't that wonderful?"]);
    expect(blocks[0]!.interim).toBe('He was honored that this guy would ask him');
  });

  it('never drops on-screen words between the final and the next partial', () => {
    const blocks = stream([
      { kind: 'interim', text: "Isn't that wonderful? He was honored that this guy", at: 1_000 },
      { kind: 'final', id: 'seg-1', text: "Isn't that wonderful?", at: 1_200 },
    ]);

    expect(captionBlockText(blocks[0]!)).toBe("Isn't that wonderful? He was honored that this guy");
  });

  it('accumulates consecutive finals into the same paragraph', () => {
    const blocks = stream([
      { kind: 'final', id: 'seg-1', text: 'And Moses said, "No."', at: 1_000 },
      { kind: 'final', id: 'seg-2', text: 'And he cried out for mercy.', at: 1_600 },
    ]);

    expect(blocks).toHaveLength(1);
    expect(captionBlockText(blocks[0]!)).toBe('And Moses said, "No." And he cried out for mercy.');
    expect(captionSegmentCount(blocks)).toBe(2);
    expect(lastCaptionSegmentId(blocks)).toBe('seg-2');
  });

  it('starts a new paragraph after a speech pause', () => {
    const blocks = stream([
      { kind: 'final', id: 'seg-1', text: 'And he cried out for mercy.', at: 1_000 },
      {
        kind: 'interim',
        text: 'Turn with me to the next chapter',
        at: 1_000 + CAPTION_PARAGRAPH_GAP_MS,
      },
    ]);

    expect(blocks).toHaveLength(2);
    expect(captionBlockText(blocks[0]!)).toBe('And he cried out for mercy.');
    expect(captionBlockText(blocks[1]!)).toBe('Turn with me to the next chapter');
  });

  it('carries an unfinalized tail into the new paragraph instead of losing it', () => {
    const blocks = stream([
      { kind: 'final', id: 'seg-1', text: 'And he cried out for mercy.', at: 1_000 },
      { kind: 'interim', text: 'and then he said', at: 1_100 },
      {
        kind: 'final',
        id: 'seg-2',
        text: 'and then he said something else.',
        at: 1_100 + CAPTION_PARAGRAPH_GAP_MS,
      },
    ]);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.interim).toBe('');
    expect(captionBlockText(blocks[1]!)).toBe('and then he said something else.');
  });
});

describe('markers and segment updates', () => {
  it('gives music its own paragraph and clears the interim tail', () => {
    const speaking = stream([{ kind: 'interim', text: 'and then he said', at: 1_000 }]);
    const blocks = appendCaptionMarker(speaking, { id: 'music-1', text: '♪ Music ♪', ts: 1_200 });

    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.interim).toBe('');
    expect(blocks[1]!.kind).toBe('marker');
    expect(captionBlockText(blocks[1]!)).toBe('♪ Music ♪');
  });

  it('starts a new paragraph after a marker rather than appending to it', () => {
    const withMarker = appendCaptionMarker([], { id: 'music-1', text: '♪ Music ♪', ts: 1_000 });
    const blocks = appendCaptionFinal(withMarker, {
      id: 'seg-1',
      text: 'Let us pray.',
      ts: 1_100,
      now: 1_100,
      blockId: 'blk-2',
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[1]!.kind).toBe('caption');
  });

  it('rewrites a segment in place when translation or audio re-sends it', () => {
    const blocks = updateCaptionSegment(
      stream([
        { kind: 'final', id: 'seg-1', text: 'And Moses said, "No."', at: 1_000 },
        { kind: 'final', id: 'seg-2', text: 'And he cried out for mercy.', at: 1_200 },
      ]),
      { id: 'seg-1', text: 'Et Moïse a dit : « Non. »' }
    );

    expect(captionBlockText(blocks[0]!)).toBe(
      'Et Moïse a dit : « Non. » And he cried out for mercy.'
    );
  });
});
