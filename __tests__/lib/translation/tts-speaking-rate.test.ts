// =============================================================================
// Tests for lib/translation/tts-speaking-rate
// =============================================================================

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clampTtsSpeakingRate,
  parseTtsSpeakingRateByLang,
  resolveTtsSpeakingRate,
} from '@/lib/translation/tts-speaking-rate';

describe('clampTtsSpeakingRate', () => {
  it("accepts rates inside Google's range", () => {
    expect(clampTtsSpeakingRate(1)).toBe(1);
    expect(clampTtsSpeakingRate(0.25)).toBe(0.25);
    expect(clampTtsSpeakingRate(2)).toBe(2);
    expect(clampTtsSpeakingRate(1.12)).toBe(1.12);
  });

  it('rejects rates outside the range or non-finite values', () => {
    expect(clampTtsSpeakingRate(0.24)).toBeNull();
    expect(clampTtsSpeakingRate(2.01)).toBeNull();
    expect(clampTtsSpeakingRate(Number.NaN)).toBeNull();
    expect(clampTtsSpeakingRate(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('parseTtsSpeakingRateByLang', () => {
  it('parses comma-separated lang:rate pairs', () => {
    const map = parseTtsSpeakingRateByLang('fr:1.12, es:1.15, zh:1.0');
    expect(map.get('fr')).toBe(1.12);
    expect(map.get('es')).toBe(1.15);
    expect(map.get('zh')).toBe(1);
  });

  it('lowercases language codes and skips invalid entries', () => {
    const map = parseTtsSpeakingRateByLang('FR:1.2,bad,xx:9, :1,en:');
    expect(map.get('fr')).toBe(1.2);
    expect(map.size).toBe(1);
  });

  it('returns an empty map for blank input', () => {
    expect(parseTtsSpeakingRateByLang(undefined).size).toBe(0);
    expect(parseTtsSpeakingRateByLang('').size).toBe(0);
    expect(parseTtsSpeakingRateByLang('   ').size).toBe(0);
  });
});

describe('resolveTtsSpeakingRate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the built-in French calibration when env is unset', () => {
    expect(resolveTtsSpeakingRate('fr', {})).toBe(1.12);
    expect(resolveTtsSpeakingRate('fr-CA', {})).toBe(1.12);
  });

  it('defaults unmeasured languages to 1.0', () => {
    expect(resolveTtsSpeakingRate('zh', {})).toBe(1);
    expect(resolveTtsSpeakingRate('en', {})).toBe(1);
  });

  it('lets a global env rate override built-ins', () => {
    expect(resolveTtsSpeakingRate('fr', { TRANSLATION_TTS_SPEAKING_RATE: '1.05' })).toBe(1.05);
  });

  it('lets a per-language env rate win over global and built-ins', () => {
    expect(
      resolveTtsSpeakingRate('fr', {
        TRANSLATION_TTS_SPEAKING_RATE: '1.05',
        TRANSLATION_TTS_SPEAKING_RATE_BY_LANG: 'fr:1.2,zh:1.0',
      })
    ).toBe(1.2);
  });

  it('matches primary subtags in per-language overrides', () => {
    expect(
      resolveTtsSpeakingRate('es-MX', {
        TRANSLATION_TTS_SPEAKING_RATE_BY_LANG: 'es:1.15',
      })
    ).toBe(1.15);
  });

  it('ignores an invalid global rate', () => {
    expect(resolveTtsSpeakingRate('zh', { TRANSLATION_TTS_SPEAKING_RATE: 'nope' })).toBe(1);
  });
});
