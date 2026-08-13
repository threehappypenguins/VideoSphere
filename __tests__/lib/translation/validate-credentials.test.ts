import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateTranslationAiConfig } from '@/lib/translation/validate-credentials';

describe('validateTranslationAiConfig', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects an invalid OpenRouter API key before listing models', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('api.deepgram.com')) {
        return Response.json({ projects: [] });
      }
      if (String(url).includes('/api/v1/key')) {
        return new Response('unauthorized', { status: 401 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await validateTranslationAiConfig({
      openRouterApiKey: 'sk-bad',
      deepgramApiKey: 'dg-ok',
      hasGcpServiceAccount: false,
      sttProvider: 'deepgram',
      textTranslateProvider: 'openrouter',
      translateModel: 'openai/gpt-4o-mini',
    });

    expect(result).toEqual({
      ok: false,
      message: 'OpenRouter API key is invalid.',
      fields: ['openRouterKey'],
    });
    expect(fetchMock).toHaveBeenCalled();
  });

  it('rejects unknown OpenRouter translation models', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/api/v1/key')) {
          return Response.json({ data: { label: 'ok' } });
        }
        if (String(url).includes('/api/v1/models')) {
          return Response.json({
            data: [{ id: 'openai/gpt-4o-mini', architecture: { input_modalities: ['text'] } }],
          });
        }
        if (String(url).includes('api.deepgram.com')) {
          return Response.json({ projects: [] });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    const result = await validateTranslationAiConfig({
      openRouterApiKey: 'sk-ok',
      deepgramApiKey: 'dg-ok',
      hasGcpServiceAccount: false,
      sttProvider: 'deepgram',
      textTranslateProvider: 'openrouter',
      translateModel: 'missing/model',
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.message).toMatch(/translation model/i);
      expect(result.fields).toEqual(['translateModel']);
    }
  });

  it('accepts Deepgram STT + OpenRouter translate models', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/api/v1/key')) {
          return Response.json({ data: { label: 'ok' } });
        }
        if (String(url).includes('/api/v1/models')) {
          return Response.json({
            data: [
              {
                id: 'openai/gpt-4o-mini',
                architecture: { input_modalities: ['text'] },
              },
            ],
          });
        }
        if (String(url).includes('api.deepgram.com')) {
          return Response.json({ projects: [] });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    const result = await validateTranslationAiConfig({
      openRouterApiKey: 'sk-ok',
      deepgramApiKey: 'dg-ok',
      hasGcpServiceAccount: false,
      sttProvider: 'deepgram',
      textTranslateProvider: 'openrouter',
      translateModel: 'openai/gpt-4o-mini',
    });

    expect(result).toEqual({ ok: true });
  });

  it('accepts Deepgram STT + GCP translate without OpenRouter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('api.deepgram.com')) {
          return Response.json({ projects: [] });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    const result = await validateTranslationAiConfig({
      openRouterApiKey: '',
      deepgramApiKey: 'dg-ok',
      hasGcpServiceAccount: true,
      sttProvider: 'deepgram',
      textTranslateProvider: 'gcp',
      translateModel: '',
    });

    expect(result).toEqual({ ok: true });
  });

  it('requires GCP SA when translate uses gcp', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('api.deepgram.com')) {
          return Response.json({ projects: [] });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    const result = await validateTranslationAiConfig({
      openRouterApiKey: '',
      groqApiKey: '',
      deepgramApiKey: 'dg-ok',
      hasGcpServiceAccount: false,
      sttProvider: 'deepgram',
      textTranslateProvider: 'gcp',
      translateModel: '',
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.fields).toContain('gcpJson');
    }
  });

  it('accepts Soniox without a separate translate provider', async () => {
    const result = await validateTranslationAiConfig({
      openRouterApiKey: '',
      sonioxApiKey: 'sx-ok-long-enough',
      hasGcpServiceAccount: false,
      sttProvider: 'soniox',
      textTranslateProvider: null,
      translateModel: '',
    });

    expect(result).toEqual({ ok: true });
  });

  it('accepts ElevenLabs keys by shape without requiring user_read HTTP access', async () => {
    const result = await validateTranslationAiConfig({
      openRouterApiKey: '',
      elevenLabsApiKey: 'sk_restricted_stt_only_key',
      hasGcpServiceAccount: true,
      sttProvider: 'elevenlabs',
      textTranslateProvider: 'gcp',
      translateModel: '',
    });

    expect(result).toEqual({ ok: true });
  });

  it('rejects short ElevenLabs API keys', async () => {
    const result = await validateTranslationAiConfig({
      openRouterApiKey: '',
      elevenLabsApiKey: 'sk_short',
      hasGcpServiceAccount: true,
      sttProvider: 'elevenlabs',
      textTranslateProvider: 'gcp',
      translateModel: '',
    });

    expect(result).toEqual({
      ok: false,
      message: 'ElevenLabs API key looks too short.',
      fields: ['elevenLabsKey'],
    });
  });
});
