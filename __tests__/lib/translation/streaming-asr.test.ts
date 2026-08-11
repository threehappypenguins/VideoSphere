import { describe, expect, it } from 'vitest';
import { applyDeepgramResult, takeUtteranceChunk } from '@/lib/translation/streaming-asr/deepgram';
import { accumulateSonioxTokens } from '@/lib/translation/streaming-asr/soniox';
import {
  assemblyaiLanguageParam,
  deepgramLanguageParam,
  shortLanguageCode,
} from '@/lib/translation/streaming-asr/types';

describe('streaming ASR language helpers', () => {
  it('maps Mandarin to Deepgram zh', () => {
    expect(deepgramLanguageParam('zh')).toBe('zh');
    expect(deepgramLanguageParam('zh-CN')).toBe('zh');
    expect(deepgramLanguageParam('en')).toBe('en');
  });

  it('selects AssemblyAI language code zh for Mandarin', () => {
    expect(assemblyaiLanguageParam('zh')).toBe('zh');
    expect(shortLanguageCode('zh-CN')).toBe('zh');
  });
});

describe('applyDeepgramResult', () => {
  it('shows interim growing on top of committed slices as partial', () => {
    const step1 = applyDeepgramResult({
      committed: '',
      transcript: 'another big',
      isFinal: false,
      speechFinal: false,
    });
    expect(step1.event).toEqual({ kind: 'partial', text: 'another big' });

    const step2 = applyDeepgramResult({
      committed: '',
      transcript: 'another big problem',
      isFinal: false,
      speechFinal: false,
    });
    expect(step2.event).toEqual({ kind: 'partial', text: 'another big problem' });
  });

  it('locks is_final slices without starting a new utterance until speech_final', () => {
    const locked = applyDeepgramResult({
      committed: '',
      transcript: 'another big problem',
      isFinal: true,
      speechFinal: false,
    });
    expect(locked.committed).toBe('another big problem');
    expect(locked.event).toEqual({ kind: 'partial', text: 'another big problem' });

    const nextInterim = applyDeepgramResult({
      committed: locked.committed,
      transcript: 'in the speech',
      isFinal: false,
      speechFinal: false,
    });
    expect(nextInterim.committed).toBe('another big problem');
    expect(nextInterim.event).toEqual({
      kind: 'partial',
      text: 'another big problem in the speech',
    });
  });

  it('emits final only on speech_final and clears committed', () => {
    const done = applyDeepgramResult({
      committed: 'yeah so my credit card number is two two',
      transcript: 'two two three three',
      isFinal: true,
      speechFinal: true,
    });
    expect(done.committed).toBe('');
    expect(done.event).toEqual({
      kind: 'final',
      text: 'yeah so my credit card number is two two two two three three',
    });
  });

  it('flushes committed on speech_final even when transcript is empty', () => {
    const done = applyDeepgramResult({
      committed: 'God had accepted his sacrifice.',
      transcript: '',
      isFinal: true,
      speechFinal: true,
    });
    expect(done.committed).toBe('');
    expect(done.event).toEqual({
      kind: 'final',
      text: 'God had accepted his sacrifice.',
    });
  });
});

describe('takeUtteranceChunk', () => {
  it('returns null while under the soft max', () => {
    expect(takeUtteranceChunk('Short caption.', 100, 160)).toBeNull();
  });

  it('splits at a sentence boundary once soft max is exceeded', () => {
    const first = 'He was on the cross being pierced in such things.';
    const second = 'And he cries out, continues to cry out for deliverance from the affliction.';
    const committed = `${first} ${second}`;
    expect(first.length).toBeLessThan(100);
    expect(committed.length).toBeGreaterThan(100);

    const split = takeUtteranceChunk(committed, 100, 160);
    expect(split).not.toBeNull();
    expect(split?.chunk).toBe(first);
    expect(split?.rest).toBe(second);
  });

  it('force-breaks near hard max when there is no sentence end', () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const split = takeUtteranceChunk(words, 100, 160);
    expect(split).not.toBeNull();
    expect(split!.chunk.length).toBeLessThanOrEqual(160);
    expect(`${split!.chunk} ${split!.rest}`.replace(/\s+/g, ' ').trim()).toBe(
      words.replace(/\s+/g, ' ').trim()
    );
  });
});

describe('accumulateSonioxTokens', () => {
  it('splits original vs translation tokens and final vs partial', () => {
    const result = accumulateSonioxTokens([
      { text: 'Hello', is_final: true, translation_status: 'original' },
      { text: ' world', is_final: false, translation_status: 'original' },
      { text: 'Hola', is_final: true, translation_status: 'translation' },
      { text: ' amigos', is_final: false, translation_status: 'translation' },
    ]);

    expect(result.finalOriginal).toBe('Hello');
    expect(result.partialOriginal).toBe('world');
    expect(result.finalTranslation).toBe('Hola');
    expect(result.partialTranslation).toBe('amigos');
  });

  it('treats missing translation_status as original', () => {
    const result = accumulateSonioxTokens([{ text: 'Amen', is_final: true }]);
    expect(result.finalOriginal).toBe('Amen');
    expect(result.finalTranslation).toBe('');
  });
});
