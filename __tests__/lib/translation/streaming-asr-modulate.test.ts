import { describe, expect, it } from 'vitest';
import {
  buildModulateStreamingUrl,
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

  it('ignores done and empty transcripts', () => {
    expect(modulateEventFromServerMessage({ type: 'done', duration_ms: 1 }, 'en')).toBeNull();
    expect(
      modulateEventFromServerMessage({ type: 'utterance', utterance: { text: '  ' } }, 'en')
    ).toBeNull();
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
