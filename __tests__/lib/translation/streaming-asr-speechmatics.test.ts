import { describe, expect, it } from 'vitest';
import {
  appendSpeechmaticsFinalSegment,
  buildSpeechmaticsTranscriptText,
  softSplitSpeechmaticsCommitted,
} from '@/lib/translation/streaming-asr/speechmatics';

describe('buildSpeechmaticsTranscriptText', () => {
  it('prefers metadata.transcript when present', () => {
    expect(
      buildSpeechmaticsTranscriptText('hello world', [
        { type: 'word', alternatives: [{ content: 'ignored' }] },
      ])
    ).toBe('hello world');
  });

  it('joins word results with spaces and attaches punctuation', () => {
    expect(
      buildSpeechmaticsTranscriptText(undefined, [
        { type: 'word', alternatives: [{ content: 'grace' }] },
        { type: 'word', alternatives: [{ content: 'of' }] },
        { type: 'word', alternatives: [{ content: 'God' }] },
        { type: 'punctuation', alternatives: [{ content: '.' }] },
      ])
    ).toBe('grace of God.');
  });
});

describe('appendSpeechmaticsFinalSegment', () => {
  it('accumulates tiny vendor finals into one committed buffer', () => {
    let committed = '';
    for (const part of ['Star', 'and', 'receiving the', 'grace', 'of', 'God.']) {
      committed = appendSpeechmaticsFinalSegment(committed, part);
    }
    expect(committed).toBe('Star and receiving the grace of God.');
  });
});

describe('softSplitSpeechmaticsCommitted', () => {
  it('does not emit one-word finals while under the soft max', () => {
    const { events, committed } = softSplitSpeechmaticsCommitted(
      'Star and receiving the grace of God for salvation.',
      'en'
    );
    expect(events).toEqual([]);
    expect(committed).toMatch(/Star and receiving/i);
  });

  it('emits caption-sized finals once the buffer grows past soft max', () => {
    const text =
      'Star and receiving the grace of God for salvation and restoration to him. So this mercy found in someone who is not reconciled to God can be seen clearly.';
    const { events, committed } = softSplitSpeechmaticsCommitted(text, 'en');
    expect(events.some((e) => e.kind === 'final')).toBe(true);
    expect(events.every((e) => e.kind !== 'final' || e.text.split(/\s+/).length > 3)).toBe(true);
    expect(
      `${events.map((e) => (e.kind === 'final' ? e.text : '')).join(' ')} ${committed}`.trim()
    ).toMatch(/reconciled/i);
  });
});
