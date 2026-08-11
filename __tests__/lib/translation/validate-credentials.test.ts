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
      sttModel: '',
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
      sttModel: '',
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
      sttModel: '',
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
      sttModel: '',
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
      sttModel: '',
      translateModel: '',
    });

    expect(result).toEqual({ ok: true });
  });
});
