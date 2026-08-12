import { describe, expect, it } from 'vitest';
import {
  alignModulateS16leFrame,
  applyModulateTranscript,
  buildModulateStreamingUrl,
  isModulateSoftReconnectError,
  modulateEventFromServerMessage,
} from '@/lib/translation/streaming-asr/modulate';

describe('modulateEventFromServerMessage', () => {
  it('maps utterance to final', () => {
    expect(
      modulateEventFromServerMessage(
        {
          type: 'utterance',
          utterance: { text: '  Hello world  ' },
        },
        'en'
      )
    ).toEqual({ kind: 'final', text: 'Hello world', language: 'en' });
  });

  it('maps partial_utterance to partial', () => {
    expect(
      modulateEventFromServerMessage(
        {
          type: 'partial_utterance',
          partial_utterance: { text: 'Hello' },
        },
        'es'
      )
    ).toEqual({ kind: 'partial', text: 'Hello', language: 'es' });
  });

  it('maps error frames', () => {
    expect(modulateEventFromServerMessage({ type: 'error', error: 'boom' }, 'en')).toEqual({
      kind: 'error',
      message: 'boom',
    });
  });

  it('treats Invalid input audio as a soft reconnect signal', () => {
    expect(isModulateSoftReconnectError('Invalid input audio')).toBe(true);
    expect(isModulateSoftReconnectError('Modulate rate limit or credits exceeded.')).toBe(false);
  });

  it('ignores done and empty transcripts', () => {
    expect(modulateEventFromServerMessage({ type: 'done', duration_ms: 1 }, 'en')).toBeNull();
    expect(
      modulateEventFromServerMessage({ type: 'utterance', utterance: { text: '  ' } }, 'en')
    ).toBeNull();
  });
});

describe('applyModulateTranscript', () => {
  it('keeps short partials as partials', () => {
    const result = applyModulateTranscript({
      kind: 'partial',
      text: 'Something that takes time',
      finalizedPrefix: '',
      sourceLanguage: 'en',
    });
    expect(result.events).toEqual([
      { kind: 'partial', text: 'Something that takes time', language: 'en' },
    ]);
    expect(result.finalizedPrefix).toBe('');
  });

  it('soft-finalizes sentence-sized chunks from a long cumulative partial', () => {
    const text =
      'Something that takes time to grow. Like, in other words, as soon as someone has reconciled to God, as soon as they trust God fully and walk with him daily.';
    const result = applyModulateTranscript({
      kind: 'partial',
      text,
      finalizedPrefix: '',
      sourceLanguage: 'en',
    });
    expect(result.events.some((e) => e.kind === 'final')).toBe(true);
    expect(result.events.filter((e) => e.kind === 'final').every((e) => e.text.length <= 160)).toBe(
      true
    );
    // Entire example ends on a complete sentence, so everything can flush as finals.
    expect(result.events.every((e) => e.kind === 'final' || e.kind === 'partial')).toBe(true);
    expect(
      result.events.reduce(
        (n, e) => n + (e.kind === 'final' || e.kind === 'partial' ? e.text.length : 0),
        0
      )
    ).toBeGreaterThan(100);
  });

  it('does not re-emit already finalized prefix on later partials', () => {
    const first =
      'Something that takes time to grow. Like, in other words, as soon as someone has reconciled to God today.';
    const step1 = applyModulateTranscript({
      kind: 'partial',
      text: first,
      finalizedPrefix: '',
      sourceLanguage: 'en',
    });
    const finals1 = step1.events.filter((e) => e.kind === 'final').map((e) => e.text);
    expect(finals1.length).toBeGreaterThan(0);

    const step2 = applyModulateTranscript({
      kind: 'partial',
      text: `${first} Now we look at mercy.`,
      finalizedPrefix: step1.finalizedPrefix,
      sourceLanguage: 'en',
    });
    for (const f of finals1) {
      expect(step2.events.filter((e) => e.kind === 'final').map((e) => e.text)).not.toContain(f);
    }
  });

  it('flushes remainder on provider final', () => {
    const result = applyModulateTranscript({
      kind: 'final',
      text: 'Short leftover clause without a period yet',
      finalizedPrefix: 'Earlier sentence already spoken.',
      sourceLanguage: 'en',
    });
    expect(result.finalizedPrefix).toBe('');
    expect(result.events).toEqual([
      {
        kind: 'final',
        text: 'Short leftover clause without a period yet',
        language: 'en',
      },
    ]);
  });
});

describe('buildModulateStreamingUrl', () => {
  it('includes PCM format params, language hint, and disables diarization', () => {
    const url = new URL(buildModulateStreamingUrl('test-key', 'zh-CN'));
    expect(url.pathname).toBe('/api/velma-2-stt-streaming');
    expect(url.searchParams.get('api_key')).toBe('test-key');
    expect(url.searchParams.get('audio_format')).toBe('s16le');
    expect(url.searchParams.get('sample_rate')).toBe('16000');
    expect(url.searchParams.get('num_channels')).toBe('1');
    expect(url.searchParams.get('partial_results')).toBe('true');
    expect(url.searchParams.get('speaker_diarization')).toBe('false');
    expect(url.searchParams.get('language')).toBe('zh');
  });
});

describe('alignModulateS16leFrame', () => {
  it('forwards even frames unchanged', () => {
    const pcm = Buffer.from([1, 2, 3, 4]);
    expect(alignModulateS16leFrame(Buffer.alloc(0), pcm)).toEqual({
      frame: pcm,
      pendingOddByte: Buffer.alloc(0),
    });
  });

  it('trims an odd frame and carries the tail byte', () => {
    expect(alignModulateS16leFrame(Buffer.alloc(0), Buffer.from([1, 2, 3]))).toEqual({
      frame: Buffer.from([1, 2]),
      pendingOddByte: Buffer.from([3]),
    });
  });

  it('prepends a carried byte onto the next frame', () => {
    expect(alignModulateS16leFrame(Buffer.from([3]), Buffer.from([4, 5]))).toEqual({
      frame: Buffer.from([3, 4]),
      pendingOddByte: Buffer.from([5]),
    });
  });

  it('buffers a lone odd byte without emitting an empty frame', () => {
    expect(alignModulateS16leFrame(Buffer.alloc(0), Buffer.from([7]))).toEqual({
      frame: Buffer.alloc(0),
      pendingOddByte: Buffer.from([7]),
    });
  });

  it('keeps every forwarded frame even across a run of odd sizes', () => {
    let pending: Buffer = Buffer.alloc(0);
    const frames: Buffer[] = [];
    for (const size of [99, 1, 3, 4097, 7, 100]) {
      const next = alignModulateS16leFrame(pending, Buffer.alloc(size, 0));
      pending = Buffer.from(next.pendingOddByte);
      if (next.frame.length > 0) frames.push(next.frame);
    }
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((f) => f.length % 2 === 0)).toBe(true);
  });
});
