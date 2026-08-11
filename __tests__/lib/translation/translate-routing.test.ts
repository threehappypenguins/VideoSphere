import { describe, expect, it } from 'vitest';
import { gcpSttLanguageCode } from '@/lib/translation/gcp-stt';
import { gcpTranslateLanguageCode } from '@/lib/translation/gcp-translate';
import { openRouterTranslateModelsList } from '@/lib/translation/openrouter-translate';
import {
  STT_PROVIDER_PRICING,
  TRANSLATE_PROVIDER_PRICING,
} from '@/lib/translation/provider-pricing';

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

describe('gcpSttLanguageCode', () => {
  it('maps common codes to Speech BCP-47 tags', () => {
    expect(gcpSttLanguageCode('en')).toBe('en-US');
    expect(gcpSttLanguageCode('zh')).toBe('zh-CN');
    expect(gcpSttLanguageCode('yue')).toBe('yue-HK');
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
    for (const id of ['openrouter', 'groq', 'gcp'] as const) {
      expect(STT_PROVIDER_PRICING[id].pricingUrl).toMatch(/^https:\/\//);
      expect(STT_PROVIDER_PRICING[id].freeUsageLimit.length).toBeGreaterThan(10);
      expect(TRANSLATE_PROVIDER_PRICING[id].pricingUrl).toMatch(/^https:\/\//);
      expect(TRANSLATE_PROVIDER_PRICING[id].freeUsageLimit.length).toBeGreaterThan(10);
    }
  });
});
