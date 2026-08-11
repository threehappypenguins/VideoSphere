import { describe, expect, it } from 'vitest';
import { gcpTranslateLanguageCode } from '@/lib/translation/gcp-translate';
import {
  buildRecentSourceContext,
  liveSermonTranslateSystemPrompt,
  liveSermonTranslateUserPrompt,
} from '@/lib/translation/mt-prompt';
import { openRouterTranslateModelsList } from '@/lib/translation/openrouter-translate';
import {
  STT_PROVIDER_PRICING,
  TRANSLATE_PROVIDER_PRICING,
} from '@/lib/translation/provider-pricing';
import {
  clarifySermonSourceForMt,
  repairSermonTranslation,
} from '@/lib/translation/sermon-source-clarify';
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

describe('live sermon MT prompts', () => {
  it('steers biblical “sinned against” away from fight/defy readings', () => {
    const system = liveSermonTranslateSystemPrompt();
    expect(system).toMatch(/sinned against/i);
    expect(system).toMatch(/not fought|not.*defied|not oppose/i);
  });

  it('adds an explicit Mandarin ban on 与主对抗 for zh targets', () => {
    const system = liveSermonTranslateSystemPrompt('zh');
    expect(system).toContain('得罪了主');
    expect(system).toContain('与主对抗');
  });

  it('includes recent source as context-only and isolates the current segment', () => {
    const user = liveSermonTranslateUserPrompt({
      sourceLanguageName: 'English',
      targetLanguageName: 'Chinese - Mandarin',
      text: 'I sinned against the Lord.',
      recentSourceContext: 'David cried out in prayer.\nHave mercy on me.',
    });
    expect(user).toContain('Recent source (context only; do not translate):');
    expect(user).toContain('David cried out in prayer.');
    expect(user).toContain('Current segment:');
    expect(user).toContain('I sinned against the Lord.');
  });

  it('omits the recent-source block when none is provided', () => {
    const user = liveSermonTranslateUserPrompt({
      sourceLanguageName: 'English',
      targetLanguageName: 'Spanish',
      text: 'Hello.',
    });
    expect(user).not.toContain('Recent source');
    expect(user).toContain('Current segment:\nHello.');
  });
});

describe('buildRecentSourceContext', () => {
  it('returns prior finals before the current segment', () => {
    const segments = [
      { id: 'a', sourceText: 'First line.' },
      { id: 'b', sourceText: 'Second line.' },
      { id: 'c', sourceText: 'I sinned against the Lord.' },
    ];
    expect(buildRecentSourceContext(segments, 'c')).toBe('First line.\nSecond line.');
  });

  it('returns empty for the first segment or unknown id', () => {
    const segments = [{ id: 'a', sourceText: 'Only.' }];
    expect(buildRecentSourceContext(segments, 'a')).toBe('');
    expect(buildRecentSourceContext(segments, 'missing')).toBe('');
  });
});

describe('clarifySermonSourceForMt', () => {
  it('removes “against” from “sinned against the Lord”', () => {
    const out = clarifySermonSourceForMt('I sinned against the Lord.');
    expect(out.toLowerCase()).toContain('sinned before the lord');
    expect(out.toLowerCase()).toContain('offended the lord');
    expect(out.toLowerCase()).not.toMatch(/against/);
  });

  it('rewrites soft-split “against the Lord” when recent context is confession', () => {
    const out = clarifySermonSourceForMt(
      'against the Lord.',
      'He frankly confessed: I have sinned'
    );
    expect(out.toLowerCase()).toContain('offended the lord');
    expect(out.toLowerCase()).not.toMatch(/\bagainst\b/);
  });

  it('leaves unrelated text unchanged', () => {
    expect(clarifySermonSourceForMt('Grace and peace to you.')).toBe('Grace and peace to you.');
  });
});

describe('repairSermonTranslation', () => {
  it('replaces Mandarin defy wording when the source is confession', () => {
    expect(
      repairSermonTranslation({
        sourceText: 'I sinned against the Lord.',
        translatedText: '他只是说：“我要与主对抗。”',
        targetLanguage: 'zh',
      })
    ).toBe('他只是说：“我得罪了主。”');
  });

  it('repairs defy wording using recent context when the current final is a fragment', () => {
    expect(
      repairSermonTranslation({
        sourceText: 'That is the right response.',
        recentSourceContext: 'I have sinned.\nagainst the Lord.',
        translatedText: '他只是说：“我要与主对抗。” 这才是正确的应对方式。',
        targetLanguage: 'zh',
      })
    ).toBe('他只是说：“我得罪了主。” 这才是正确的应对方式。');
  });

  it('repairs 背叛上帝 from soft-split against-God readings', () => {
    expect(
      repairSermonTranslation({
        sourceText: 'against God.',
        recentSourceContext: 'I have sinned.',
        translatedText: '背叛上帝。这真是个绝妙的忏悔。',
        targetLanguage: 'zh',
      })
    ).toBe('得罪了上帝。这真是个绝妙的忏悔。');
  });

  it('repairs known bad Mandarin even when source text is missing (Soniox)', () => {
    expect(
      repairSermonTranslation({
        sourceText: '',
        translatedText: '我要与主对抗。',
        targetLanguage: 'zh',
      })
    ).toBe('我得罪了主。');
  });

  it('does not rewrite when English explicitly says defy', () => {
    const text = '我要与主对抗。';
    expect(
      repairSermonTranslation({
        sourceText: 'I will defy the Lord.',
        translatedText: text,
        targetLanguage: 'zh',
      })
    ).toBe(text);
  });
});
