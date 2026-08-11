import { describe, expect, it } from 'vitest';
import {
  isListenReady,
  isSttReady,
  isTextTranslateReady,
  isTranslationReady,
  normalizeSttProvider,
  normalizeTextTranslateProvider,
  sttProvidesBuiltInTranslation,
} from '@/lib/translation/capabilities';

describe('translation capabilities', () => {
  it('normalizes streaming STT providers and treats legacy openrouter/gcp as unset', () => {
    expect(normalizeSttProvider(undefined)).toBeNull();
    expect(normalizeSttProvider('groq')).toBe('groq');
    expect(normalizeSttProvider('deepgram')).toBe('deepgram');
    expect(normalizeSttProvider('soniox')).toBe('soniox');
    expect(normalizeSttProvider('gcp')).toBeNull();
    expect(normalizeSttProvider('openrouter')).toBeNull();
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
        hasDeepgramKey: true,
        sttModel: 'whisper-large-v3-turbo',
        openRouterTranslateModel: 'model',
        hasGcpServiceAccount: true,
        gcpTtsVoices: {},
      })
    ).toBe(false);
  });

  it('allows Deepgram STT + GCP Translation with only a Deepgram key', () => {
    expect(
      isSttReady({
        sttProvider: 'deepgram',
        hasDeepgramKey: true,
        hasOpenRouterKey: false,
        sttModel: '',
        openRouterTranslateModel: '',
        hasGcpServiceAccount: true,
        gcpTtsVoices: {},
      })
    ).toBe(true);

    expect(
      isTranslationReady({
        sttProvider: 'deepgram',
        textTranslateProvider: 'gcp',
        hasDeepgramKey: true,
        hasOpenRouterKey: false,
        hasGroqKey: false,
        sttModel: '',
        openRouterTranslateModel: '',
        hasGcpServiceAccount: true,
        gcpTtsVoices: {},
      })
    ).toBe(true);
  });

  it('treats Soniox as STT+MT without a separate translate provider', () => {
    expect(sttProvidesBuiltInTranslation('soniox')).toBe(true);
    expect(
      isTextTranslateReady({
        sttProvider: 'soniox',
        hasSonioxKey: true,
        hasOpenRouterKey: false,
        sttModel: '',
        openRouterTranslateModel: '',
        hasGcpServiceAccount: false,
        gcpTtsVoices: {},
      })
    ).toBe(true);

    expect(
      isTranslationReady({
        sttProvider: 'soniox',
        textTranslateProvider: null,
        hasSonioxKey: true,
        hasOpenRouterKey: false,
        sttModel: '',
        openRouterTranslateModel: '',
        hasGcpServiceAccount: false,
        gcpTtsVoices: {},
      })
    ).toBe(true);

    expect(
      isTranslationReady({
        sttProvider: 'soniox',
        hasSonioxKey: false,
        hasOpenRouterKey: false,
        sttModel: '',
        openRouterTranslateModel: '',
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

  it('requires Groq key and model for chunked Groq STT', () => {
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

    expect(
      isSttReady({
        sttProvider: 'groq',
        hasGroqKey: true,
        hasOpenRouterKey: false,
        sttModel: '',
        openRouterTranslateModel: '',
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
        sttProvider: 'deepgram',
        textTranslateProvider: 'gcp',
        hasDeepgramKey: false,
        hasOpenRouterKey: false,
        sttModel: '',
        openRouterTranslateModel: '',
        hasGcpServiceAccount: true,
        gcpTtsVoices: { es: 'es-US-Neural2-A' },
      })
    ).toBe(false);
  });
});
