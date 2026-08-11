import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateTranslationAiConfig } from '@/lib/translation/validate-credentials';

describe('validateTranslationAiConfig', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects an invalid OpenRouter API key before listing models', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/api/v1/key')) {
        return new Response('unauthorized', { status: 401 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await validateTranslationAiConfig({
      openRouterApiKey: 'sk-bad',
      hasGcpServiceAccount: false,
      sttProvider: 'openrouter',
      textTranslateProvider: 'openrouter',
      sttModel: 'openai/whisper-large-v3',
      translateModel: 'openai/gpt-4o-mini',
    });

    expect(result).toEqual({
      ok: false,
      message: 'OpenRouter API key is invalid.',
      fields: ['openRouterKey'],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    const result = await validateTranslationAiConfig({
      openRouterApiKey: 'sk-ok',
      hasGcpServiceAccount: false,
      sttProvider: 'openrouter',
      textTranslateProvider: 'openrouter',
      sttModel: 'openai/whisper-large-v3',
      translateModel: 'missing/model',
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.message).toMatch(/translation model/i);
      expect(result.fields).toEqual(['translateModel']);
    }
  });

  it('accepts valid OpenRouter STT + translate models', async () => {
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
                id: 'openai/whisper-large-v3',
                architecture: { input_modalities: ['audio'] },
              },
              {
                id: 'openai/gpt-4o-mini',
                architecture: { input_modalities: ['text'] },
              },
            ],
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    const result = await validateTranslationAiConfig({
      openRouterApiKey: 'sk-ok',
      hasGcpServiceAccount: false,
      sttProvider: 'openrouter',
      textTranslateProvider: 'openrouter',
      sttModel: 'openai/whisper-large-v3',
      translateModel: 'openai/gpt-4o-mini',
    });

    expect(result).toEqual({ ok: true });
  });

  it('validates Groq key and STT model when provider is groq', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('openrouter.ai/api/v1/key')) {
          return Response.json({ data: { label: 'ok' } });
        }
        if (String(url).includes('openrouter.ai/api/v1/models')) {
          return Response.json({
            data: [{ id: 'openai/gpt-oss-20b:free', architecture: { input_modalities: ['text'] } }],
          });
        }
        if (String(url).includes('api.groq.com')) {
          return Response.json({
            data: [{ id: 'whisper-large-v3-turbo' }],
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    const result = await validateTranslationAiConfig({
      openRouterApiKey: 'sk-ok',
      groqApiKey: 'gsk_ok',
      hasGcpServiceAccount: false,
      sttProvider: 'groq',
      textTranslateProvider: 'openrouter',
      sttModel: 'whisper-large-v3-turbo',
      translateModel: 'openai/gpt-oss-20b:free',
    });

    expect(result).toEqual({ ok: true });
  });

  it('rejects missing Groq STT models', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('openrouter.ai/api/v1/key')) {
          return Response.json({ data: { label: 'ok' } });
        }
        if (String(url).includes('openrouter.ai/api/v1/models')) {
          return Response.json({
            data: [{ id: 'openai/gpt-oss-20b:free' }],
          });
        }
        if (String(url).includes('api.groq.com')) {
          return Response.json({ data: [{ id: 'whisper-large-v3' }] });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    const result = await validateTranslationAiConfig({
      openRouterApiKey: 'sk-ok',
      groqApiKey: 'gsk_ok',
      hasGcpServiceAccount: false,
      sttProvider: 'groq',
      textTranslateProvider: 'openrouter',
      sttModel: 'not-a-real-whisper',
      translateModel: 'openai/gpt-oss-20b:free',
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.message).toMatch(/Groq STT model/i);
      expect(result.fields).toEqual(['sttModel']);
    }
  });

  it('accepts Groq STT + GCP translate without OpenRouter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('api.groq.com')) {
          return Response.json({ data: [{ id: 'whisper-large-v3-turbo' }] });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    const result = await validateTranslationAiConfig({
      openRouterApiKey: '',
      groqApiKey: 'gsk_ok',
      hasGcpServiceAccount: true,
      sttProvider: 'groq',
      textTranslateProvider: 'gcp',
      sttModel: 'whisper-large-v3-turbo',
      translateModel: '',
    });

    expect(result).toEqual({ ok: true });
  });

  it('requires GCP SA when STT or translate uses gcp', async () => {
    const result = await validateTranslationAiConfig({
      openRouterApiKey: '',
      groqApiKey: '',
      hasGcpServiceAccount: false,
      sttProvider: 'gcp',
      textTranslateProvider: 'gcp',
      sttModel: 'latest_long',
      translateModel: '',
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.fields).toContain('gcpJson');
    }
  });
});
