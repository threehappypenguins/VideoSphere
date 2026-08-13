import { describe, expect, it } from 'vitest';
import { gladiaEventFromServerMessage } from '@/lib/translation/streaming-asr/gladia';

describe('gladiaEventFromServerMessage', () => {
  it('maps final transcript utterance.text to final', () => {
    expect(
      gladiaEventFromServerMessage(
        {
          type: 'transcript',
          data: {
            is_final: true,
            utterance: { text: '  Hello world  ' },
          },
        },
        'en'
      )
    ).toEqual({ kind: 'final', text: 'Hello world', language: 'en' });
  });

  it('maps partial transcript utterance.text to partial', () => {
    expect(
      gladiaEventFromServerMessage(
        {
          type: 'transcript',
          data: {
            is_final: false,
            utterance: { text: 'Hello' },
          },
        },
        'en'
      )
    ).toEqual({ kind: 'partial', text: 'Hello', language: 'en' });
  });

  it('ignores non-transcript frames and empty utterance text', () => {
    expect(gladiaEventFromServerMessage({ type: 'started' }, 'en')).toBeNull();
    expect(
      gladiaEventFromServerMessage(
        {
          type: 'transcript',
          data: { is_final: true, utterance: { text: '  ' } },
        },
        'en'
      )
    ).toBeNull();
  });

  it('does not treat the utterance object as a string (regression)', () => {
    // Prior bug: utterance?.trim() on an object always yielded empty text.
    const event = gladiaEventFromServerMessage(
      {
        type: 'transcript',
        data: {
          is_final: true,
          utterance: {
            text: 'Amen',
            start: 0.1,
            end: 0.4,
            language: 'en',
            confidence: 1,
            channel: 0,
            words: [],
          },
        },
      },
      'en'
    );
    expect(event).toEqual({ kind: 'final', text: 'Amen', language: 'en' });
  });
});
