import { describe, expect, it } from 'vitest';
import {
  isListenReady,
  isTextTranslateReady,
  isTranslationReady,
  normalizeSttProvider,
  normalizeTextTranslateProvider,
} from '@/lib/translation/capabilities';

describe('translation capabilities', () => {
  it('returns null for unset or unknown STT providers', () => {
    expect(normalizeSttProvider(undefined)).toBeNull();
    expect(normalizeSttProvider('groq')).toBe('groq');
    expect(normalizeSttProvider('gcp')).toBe('gcp');
    expect(normalizeSttProvider('openrouter')).toBe('openrouter');
    expect(normalizeSttProvider('other')).toBeNull();
  });

  it('returns null for unset or unknown translate providers', () => {
    expect(normalizeTextTranslateProvider(undefined)).toBeNull();
    expect(normalizeTextTranslateProvider('gcp')).toBe('gcp');
    expect(normalizeTextTranslateProvider('groq')).toBe('groq');
    expect(normalizeTextTranslateProvider('openrouter')).toBe('openrouter');
    expect(normalizeTextTranslateProvider('other')).toBeNull();
  });

  it('is not ready when providers are unset', () => {
    expect(
      isTranslationReady({
        hasOpenRouterKey: true,
        hasGroqKey: true,
        sttModel: 'whisper-large-v3-turbo',
        openRouterTranslateModel: 'model',
        hasGcpServiceAccount: true,
        gcpTtsVoices: {},
      })
    ).toBe(false);
  });

  it('requires OpenRouter translate + OpenRouter STT when both providers are openrouter', () => {
    expect(
      isTranslationReady({
        sttProvider: 'openrouter',
        textTranslateProvider: 'openrouter',
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
        textTranslateProvider: 'openrouter',
        hasOpenRouterKey: false,
        sttModel: 'openai/whisper-large-v3',
        openRouterTranslateModel: 'some/model',
        hasGcpServiceAccount: false,
        gcpTtsVoices: {},
      })
    ).toBe(false);
  });

  it('allows Groq STT + GCP Translation without OpenRouter', () => {
    expect(
      isTextTranslateReady({
        textTranslateProvider: 'gcp',
        hasOpenRouterKey: false,
        sttModel: 'whisper-large-v3-turbo',
        openRouterTranslateModel: '',
        hasGcpServiceAccount: true,
        gcpTtsVoices: {},
      })
    ).toBe(true);

    expect(
      isTranslationReady({
        sttProvider: 'groq',
        textTranslateProvider: 'gcp',
        hasOpenRouterKey: false,
        hasGroqKey: true,
        sttModel: 'whisper-large-v3-turbo',
        openRouterTranslateModel: '',
        hasGcpServiceAccount: true,
        gcpTtsVoices: {},
      })
    ).toBe(true);
  });

  it('allows GCP STT when SA and recognition model are set', () => {
    expect(
      isTranslationReady({
        sttProvider: 'gcp',
        textTranslateProvider: 'gcp',
        hasOpenRouterKey: false,
        hasGroqKey: false,
        sttModel: 'latest_long',
        openRouterTranslateModel: '',
        hasGcpServiceAccount: true,
        gcpTtsVoices: {},
      })
    ).toBe(true);
  });

  it('does not treat GCP SA as OpenRouter translate fallback', () => {
    expect(
      isTextTranslateReady({
        textTranslateProvider: 'openrouter',
        hasOpenRouterKey: false,
        sttModel: 'stt',
        openRouterTranslateModel: 'model',
        hasGcpServiceAccount: true,
        gcpTtsVoices: {},
      })
    ).toBe(false);
  });

  it('requires Groq key for STT when provider is groq', () => {
    expect(
      isTranslationReady({
        sttProvider: 'groq',
        textTranslateProvider: 'openrouter',
        hasOpenRouterKey: true,
        hasGroqKey: false,
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
        sttProvider: 'groq',
        textTranslateProvider: 'gcp',
        hasOpenRouterKey: false,
        hasGroqKey: true,
        sttModel: 'stt',
        openRouterTranslateModel: '',
        hasGcpServiceAccount: true,
        gcpTtsVoices: { es: 'es-US-Neural2-A' },
      })
    ).toBe(true);

    expect(
      isListenReady({
        sttProvider: 'openrouter',
        textTranslateProvider: 'openrouter',
        hasOpenRouterKey: false,
        sttModel: 'stt',
        openRouterTranslateModel: 'tr',
        hasGcpServiceAccount: true,
        gcpTtsVoices: { es: 'es-US-Neural2-A' },
      })
    ).toBe(false);
  });
});
