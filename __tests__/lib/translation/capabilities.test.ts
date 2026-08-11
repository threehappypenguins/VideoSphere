import { describe, expect, it } from 'vitest';
import {
  isListenReady,
  isTranslationReady,
  normalizeSttProvider,
} from '@/lib/translation/capabilities';

describe('translation capabilities', () => {
  it('normalizes unknown STT providers to openrouter', () => {
    expect(normalizeSttProvider(undefined)).toBe('openrouter');
    expect(normalizeSttProvider('groq')).toBe('groq');
    expect(normalizeSttProvider('other')).toBe('openrouter');
  });

  it('requires OpenRouter translate + OpenRouter STT when provider is openrouter', () => {
    expect(
      isTranslationReady({
        sttProvider: 'openrouter',
        hasOpenRouterKey: true,
        hasGroqKey: false,
        sttModel: 'openai/whisper-large-v3',
        openRouterTranslateModel: 'some/model',
        hasGcpServiceAccount: false,
        gcpTtsVoices: {},
      })
    ).toBe(true);

    expect(
      isTranslationReady({
        sttProvider: 'openrouter',
        hasOpenRouterKey: false,
        sttModel: 'openai/whisper-large-v3',
        openRouterTranslateModel: 'some/model',
        hasGcpServiceAccount: false,
        gcpTtsVoices: {},
      })
    ).toBe(false);

    expect(
      isTranslationReady({
        sttProvider: 'openrouter',
        hasOpenRouterKey: true,
        sttModel: '',
        openRouterTranslateModel: 'some/model',
        hasGcpServiceAccount: false,
        gcpTtsVoices: {},
      })
    ).toBe(false);
  });

  it('requires Groq key for STT when provider is groq, plus OpenRouter for translate', () => {
    expect(
      isTranslationReady({
        sttProvider: 'groq',
        hasOpenRouterKey: true,
        hasGroqKey: true,
        sttModel: 'whisper-large-v3-turbo',
        openRouterTranslateModel: 'openai/gpt-oss-20b:free',
        hasGcpServiceAccount: false,
        gcpTtsVoices: {},
      })
    ).toBe(true);

    expect(
      isTranslationReady({
        sttProvider: 'groq',
        hasOpenRouterKey: true,
        hasGroqKey: false,
        sttModel: 'whisper-large-v3-turbo',
        openRouterTranslateModel: 'openai/gpt-oss-20b:free',
        hasGcpServiceAccount: false,
        gcpTtsVoices: {},
      })
    ).toBe(false);

    expect(
      isTranslationReady({
        sttProvider: 'groq',
        hasOpenRouterKey: false,
        hasGroqKey: true,
        sttModel: 'whisper-large-v3-turbo',
        openRouterTranslateModel: 'openai/gpt-oss-20b:free',
        hasGcpServiceAccount: false,
        gcpTtsVoices: {},
      })
    ).toBe(false);
  });

  it('requires translation readiness plus GCP SA and voice for listen', () => {
    expect(
      isListenReady({
        sttProvider: 'openrouter',
        hasOpenRouterKey: true,
        sttModel: 'stt',
        openRouterTranslateModel: 'tr',
        hasGcpServiceAccount: true,
        gcpTtsVoices: { es: 'es-US-Neural2-A' },
      })
    ).toBe(true);

    expect(
      isListenReady({
        sttProvider: 'openrouter',
        hasOpenRouterKey: true,
        sttModel: 'stt',
        openRouterTranslateModel: 'tr',
        hasGcpServiceAccount: true,
        gcpTtsVoices: {},
      })
    ).toBe(false);

    expect(
      isListenReady({
        sttProvider: 'openrouter',
        hasOpenRouterKey: false,
        sttModel: 'stt',
        openRouterTranslateModel: 'tr',
        hasGcpServiceAccount: true,
        gcpTtsVoices: { es: 'es-US-Neural2-A' },
      })
    ).toBe(false);
  });
});
