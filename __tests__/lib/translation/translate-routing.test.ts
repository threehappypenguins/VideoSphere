import { describe, expect, it } from 'vitest';
import { gcpTranslateLanguageCode } from '@/lib/translation/gcp-translate';
import { openRouterTranslateModelsList } from '@/lib/translation/openrouter-translate';
import {
  STT_PROVIDER_PRICING,
  TRANSLATE_PROVIDER_PRICING,
} from '@/lib/translation/provider-pricing';
import {
  assemblyaiLanguageParam,
  deepgramLanguageParam,
} from '@/lib/translation/streaming-asr/types';

describe('gcpTranslateLanguageCode', () => {
  it('maps Mandarin and Cantonese to Cloud Translation tags', () => {
    expect(gcpTranslateLanguageCode('zh')).toBe('zh-CN');
    expect(gcpTranslateLanguageCode('yue')).toBe('yue');
  });

  it('passes through common ISO codes', () => {
    expect(gcpTranslateLanguageCode('es')).toBe('es');
    expect(gcpTranslateLanguageCode('nl')).toBe('nl');
  });
});

describe('streaming ASR language params', () => {
  it('maps Mandarin for Deepgram and AssemblyAI', () => {
    expect(deepgramLanguageParam('zh')).toBe('zh');
    expect(assemblyaiLanguageParam('zh')).toBe('zh');
  });
});

describe('openRouterTranslateModelsList', () => {
  it('adds openrouter/free failover for :free primaries', () => {
    expect(openRouterTranslateModelsList('openai/gpt-oss-20b:free')).toEqual([
      'openai/gpt-oss-20b:free',
      'openrouter/free',
    ]);
  });

  it('does not duplicate openrouter/free', () => {
    expect(openRouterTranslateModelsList('openrouter/free')).toEqual(['openrouter/free']);
  });
});

describe('provider pricing metadata', () => {
  it('exposes pricing URLs for every STT and translate provider', () => {
    for (const id of [
      'deepgram',
      'assemblyai',
      'gladia',
      'speechmatics',
      'soniox',
      'groq',
    ] as const) {
      expect(STT_PROVIDER_PRICING[id].pricingUrl).toMatch(/^https:\/\//);
      expect(STT_PROVIDER_PRICING[id].freeUsageLimit.length).toBeGreaterThan(10);
    }
    for (const id of ['openrouter', 'groq', 'gcp'] as const) {
      expect(TRANSLATE_PROVIDER_PRICING[id].pricingUrl).toMatch(/^https:\/\//);
      expect(TRANSLATE_PROVIDER_PRICING[id].freeUsageLimit.length).toBeGreaterThan(10);
    }
  });
});
