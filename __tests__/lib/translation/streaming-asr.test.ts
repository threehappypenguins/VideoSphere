import { describe, expect, it } from 'vitest';
import { applyDeepgramResult, takeUtteranceChunk } from '@/lib/translation/streaming-asr/deepgram';
import {
  accumulateSonioxTokens,
  applySonioxTokenFrame,
  createSonioxUtteranceState,
  isSonioxControlToken,
  parseSonioxTokenFrame,
} from '@/lib/translation/streaming-asr/soniox';
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

  it('omits endpoint control tokens from caption text', () => {
    const result = accumulateSonioxTokens([
      { text: 'Amen', is_final: true },
      { text: '<end>', is_final: true },
    ]);
    expect(result.finalOriginal).toBe('Amen');
    expect(isSonioxControlToken('<end>')).toBe(true);
    expect(isSonioxControlToken('<fin>')).toBe(true);
  });
});

describe('applySonioxTokenFrame', () => {
  it('accumulates incremental finals as partials instead of committing each batch', () => {
    let state = createSonioxUtteranceState();

    const step1 = applySonioxTokenFrame({
      tokens: [
        { text: 'God', is_final: true },
        { text: '.', is_final: true },
      ],
      state,
      sourceLanguage: 'en',
    });
    state = step1.state;
    expect(step1.events).toEqual([
      { kind: 'partial', text: 'God.', language: 'en', isTranslation: false },
    ]);
    expect(state.committedOriginal).toBe('God.');

    const step2 = applySonioxTokenFrame({
      tokens: [
        { text: ' He', is_final: true },
        { text: ' just', is_final: true },
        { text: ' has', is_final: false },
      ],
      state,
      sourceLanguage: 'en',
    });
    state = step2.state;
    expect(step2.events.some((e) => e.kind === 'final')).toBe(false);
    expect(step2.events).toContainEqual({
      kind: 'partial',
      text: 'God. He just has',
      language: 'en',
      isTranslation: false,
    });
    // Leading punctuation stays attached to the growing utterance — not its own caption.
    expect(state.committedOriginal).toBe('God. He just');
  });

  it('flushes the accumulated utterance on <end>', () => {
    let state = createSonioxUtteranceState();

    state = applySonioxTokenFrame({
      tokens: [
        { text: 'Ask', is_final: true },
        { text: ' him', is_final: true },
      ],
      state,
      sourceLanguage: 'en',
    }).state;

    const done = applySonioxTokenFrame({
      tokens: [
        { text: '.', is_final: true },
        { text: '<end>', is_final: true },
      ],
      state,
      sourceLanguage: 'en',
    });

    expect(done.events).toEqual([
      { kind: 'final', text: 'Ask him.', language: 'en', isTranslation: false },
    ]);
    expect(done.state.committedOriginal).toBe('');
    expect(done.state.finalizedPrefixOriginal).toBe('');
  });

  it('soft-splits long continuous speech at sentence boundaries before endpoint', () => {
    const first = 'He was on the cross being pierced in such things.';
    const second = 'And he cries out, continues to cry out for deliverance from the affliction.';
    expect(first.length).toBeGreaterThan(40);
    expect(`${first} ${second}`.length).toBeGreaterThan(100);

    const tokens = `${first} ${second}`
      .split(/(\s+)/)
      .filter(Boolean)
      .map((text) => ({ text, is_final: true as const }));

    const result = applySonioxTokenFrame({
      tokens,
      state: createSonioxUtteranceState(),
      sourceLanguage: 'en',
    });

    const finals = result.events.filter((e) => e.kind === 'final');
    expect(finals.length).toBeGreaterThanOrEqual(1);
    expect(finals[0]).toMatchObject({ kind: 'final', text: first, isTranslation: false });
  });

  it('soft-splits Chinese translation on fullwidth 。 without spaces', () => {
    const first = '就能成就我所求的。';
    const second = '耶稣说："这位妇人明白了。"';
    const third =
      '我记得我称她为外邦人中的以色列人，因为以色列人就是这样得名的，就是雅各向神呼求的时候。';
    const fourth = '求那样的慈悲，因为他认识到神是慈悲的，并且向他呼求。';
    const text = `${first}${second}${third}${fourth}`;
    expect(text.length).toBeGreaterThan(90);

    const result = applySonioxTokenFrame({
      tokens: [{ text, is_final: true, translation_status: 'translation' }],
      state: createSonioxUtteranceState(),
      sourceLanguage: 'en',
      targetLanguage: 'zh',
    });

    const finals = result.events.filter(
      (e): e is Extract<typeof e, { kind: 'final' }> =>
        e.kind === 'final' && Boolean(e.isTranslation)
    );
    expect(finals.length).toBeGreaterThanOrEqual(1);
    // Soft-split prefers the last 。 that still fits the soft window.
    expect(finals[0]!.text.startsWith(first)).toBe(true);
    expect(finals[0]!.text.includes('。')).toBe(true);
  });

  it('marks endpoint when parsing <end> without including it in text', () => {
    const frame = parseSonioxTokenFrame([
      { text: 'Hello', is_final: true },
      { text: '<end>', is_final: true },
    ]);
    expect(frame.endpoint).toBe(true);
    expect(frame.deltaFinalOriginal).toBe('Hello');
  });
});
