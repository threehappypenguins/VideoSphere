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
  it('normalizes streaming STT providers and rejects unknown values', () => {
    expect(normalizeSttProvider(undefined)).toBeNull();
    expect(normalizeSttProvider('deepgram')).toBe('deepgram');
    expect(normalizeSttProvider('soniox')).toBe('soniox');
    expect(normalizeSttProvider('modulate')).toBe('modulate');
    expect(normalizeSttProvider('elevenlabs')).toBe('elevenlabs');
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
        openRouterTranslateModel: '',
        hasGcpServiceAccount: false,
        gcpTtsVoices: {},
      })
    ).toBe(false);
  });

  it('allows Groq chat translation with a streaming STT provider', () => {
    expect(
      isTextTranslateReady({
        textTranslateProvider: 'groq',
        hasOpenRouterKey: false,
        hasGroqKey: true,
        openRouterTranslateModel: 'llama-3.1-8b-instant',
        hasGcpServiceAccount: false,
        gcpTtsVoices: {},
      })
    ).toBe(true);

    expect(
      isTranslationReady({
        sttProvider: 'deepgram',
        textTranslateProvider: 'groq',
        hasDeepgramKey: true,
        hasOpenRouterKey: false,
        hasGroqKey: true,
        openRouterTranslateModel: 'llama-3.1-8b-instant',
        hasGcpServiceAccount: false,
        gcpTtsVoices: {},
      })
    ).toBe(true);
  });

  it('does not treat GCP SA as OpenRouter translate fallback', () => {
    expect(
      isTextTranslateReady({
        textTranslateProvider: 'openrouter',
        hasOpenRouterKey: false,
        openRouterTranslateModel: 'model',
        hasGcpServiceAccount: true,
        gcpTtsVoices: {},
      })
    ).toBe(false);
  });

  it('requires translation readiness plus GCP SA and voice for listen', () => {
    expect(
      isListenReady({
        sttProvider: 'deepgram',
        textTranslateProvider: 'gcp',
        hasDeepgramKey: true,
        hasOpenRouterKey: false,
        hasGroqKey: false,
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
        openRouterTranslateModel: '',
        hasGcpServiceAccount: true,
        gcpTtsVoices: { es: 'es-US-Neural2-A' },
      })
    ).toBe(false);
  });

  it('treats Modulate as ready when a Modulate key is present', () => {
    expect(
      isSttReady({
        sttProvider: 'modulate',
        hasModulateKey: true,
        hasOpenRouterKey: false,
        openRouterTranslateModel: '',
        hasGcpServiceAccount: false,
        gcpTtsVoices: {},
      })
    ).toBe(true);

    expect(
      isSttReady({
        sttProvider: 'modulate',
        hasModulateKey: false,
        hasOpenRouterKey: false,
        openRouterTranslateModel: '',
        hasGcpServiceAccount: false,
        gcpTtsVoices: {},
      })
    ).toBe(false);
  });

  it('treats ElevenLabs as ready when an ElevenLabs key is present', () => {
    expect(
      isSttReady({
        sttProvider: 'elevenlabs',
        hasElevenLabsKey: true,
        hasOpenRouterKey: false,
        openRouterTranslateModel: '',
        hasGcpServiceAccount: false,
        gcpTtsVoices: {},
      })
    ).toBe(true);

    expect(
      isSttReady({
        sttProvider: 'elevenlabs',
        hasElevenLabsKey: false,
        hasOpenRouterKey: false,
        openRouterTranslateModel: '',
        hasGcpServiceAccount: false,
        gcpTtsVoices: {},
      })
    ).toBe(false);
  });
});
