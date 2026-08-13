import { describe, expect, it } from 'vitest';
import {
  applyElevenLabsServerMessage,
  applyElevenLabsTranscript,
  buildElevenLabsStreamingUrl,
  elevenLabsEventFromServerMessage,
  ELEVENLABS_REALTIME_MODEL_ID,
} from '@/lib/translation/streaming-asr/elevenlabs';

describe('elevenLabsEventFromServerMessage', () => {
  it('maps partial and committed transcripts', () => {
    expect(
      elevenLabsEventFromServerMessage({
        message_type: 'partial_transcript',
        text: 'Hello world',
      })
    ).toEqual({ kind: 'partial', text: 'Hello world' });

    expect(
      elevenLabsEventFromServerMessage({
        message_type: 'final_transcript',
        text: 'Hello world.',
      })
    ).toEqual({ kind: 'partial', text: 'Hello world.' });

    expect(
      elevenLabsEventFromServerMessage({
        message_type: 'committed_transcript',
        text: 'Hello world.',
      })
    ).toEqual({ kind: 'final', text: 'Hello world.' });
  });

  it('maps auth and quota errors', () => {
    expect(
      elevenLabsEventFromServerMessage({
        message_type: 'auth_error',
        error: 'invalid api key',
      })
    ).toEqual({ kind: 'error', message: 'ElevenLabs: invalid api key' });
  });

  it('ignores session_started and empty text', () => {
    expect(elevenLabsEventFromServerMessage({ message_type: 'session_started' })).toBeNull();
    expect(
      elevenLabsEventFromServerMessage({ message_type: 'partial_transcript', text: '  ' })
    ).toBeNull();
  });
});

describe('applyElevenLabsTranscript', () => {
  it('soft-splits a long cumulative segment into sentence-sized finals', () => {
    const text =
      'And when he requested, they set food before him and he ate. Then his servants said to him, what is this you have done? You fasted and wept for the child while he was alive, but when the child died, you arose and ate.';
    const result = applyElevenLabsTranscript({
      kind: 'partial',
      text,
      finalizedPrefix: '',
      sourceLanguage: 'en',
    });
    const finals = result.events.filter((e) => e.kind === 'final');
    expect(finals.length).toBeGreaterThan(1);
    expect(finals.every((e) => e.kind === 'final' && e.text.length <= 200)).toBe(true);
  });
});

describe('applyElevenLabsServerMessage', () => {
  it('resets the segment lock after a committed transcript', () => {
    const result = applyElevenLabsServerMessage(
      { message_type: 'committed_transcript', text: 'Amen.' },
      '',
      'en'
    );
    expect(result.resetSegment).toBe(true);
    expect(result.finalizedPrefix).toBe('');
    expect(result.events).toEqual([{ kind: 'final', text: 'Amen.', language: 'en' }]);
  });

  it('keeps the soft-split prefix across partials', () => {
    const long =
      'Why should I fast? Can I bring him back again? I shall go to him, but he shall not return to me.';
    const step1 = applyElevenLabsServerMessage(
      { message_type: 'partial_transcript', text: long },
      '',
      'en'
    );
    expect(step1.resetSegment).toBe(false);
    expect(step1.events.some((e) => e.kind === 'final')).toBe(true);

    const step2 = applyElevenLabsServerMessage(
      {
        message_type: 'partial_transcript',
        text: `${long} Then David comforted Bathsheba his wife.`,
      },
      step1.finalizedPrefix,
      'en'
    );
    expect(step2.resetSegment).toBe(false);
  });
});

describe('buildElevenLabsStreamingUrl', () => {
  it('requests Scribe v2 realtime with VAD commit and PCM 16 kHz', () => {
    const url = new URL(buildElevenLabsStreamingUrl('en-US'));
    expect(url.origin + url.pathname).toBe('wss://api.elevenlabs.io/v1/speech-to-text/realtime');
    expect(url.searchParams.get('model_id')).toBe(ELEVENLABS_REALTIME_MODEL_ID);
    expect(url.searchParams.get('audio_format')).toBe('pcm_16000');
    expect(url.searchParams.get('commit_strategy')).toBe('vad');
    expect(url.searchParams.get('language_code')).toBe('en');
    expect(url.searchParams.get('no_verbatim')).toBe('true');
  });
});
