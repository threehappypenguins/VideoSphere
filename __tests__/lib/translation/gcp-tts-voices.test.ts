/**
 * Tests for GCP TTS listen-language ↔ voice matching (Chinese aliases, etc.).
 */
import { describe, expect, it } from 'vitest';
import {
  gcpTtsLanguageBasesForListenLanguage,
  gcpVoiceMatchesListenLanguage,
  voiceMatchesListenLanguage,
} from '@/lib/translation/gcp-tts-voices';

describe('gcpTtsLanguageBasesForListenLanguage', () => {
  it('maps Mandarin to zh/cmn and Cantonese to yue only', () => {
    expect(gcpTtsLanguageBasesForListenLanguage('zh')).toEqual(['zh', 'cmn']);
    expect(gcpTtsLanguageBasesForListenLanguage('yue')).toEqual(['yue']);
  });

  it('maps Tagalog to include fil', () => {
    expect(gcpTtsLanguageBasesForListenLanguage('tl')).toEqual(['tl', 'fil']);
  });
});

describe('gcpVoiceMatchesListenLanguage', () => {
  it('matches Mandarin voices for zh and Cantonese for yue', () => {
    expect(
      gcpVoiceMatchesListenLanguage({ name: 'cmn-CN-Wavenet-A', languageCodes: ['cmn-CN'] }, 'zh')
    ).toBe(true);
    expect(
      gcpVoiceMatchesListenLanguage(
        { name: 'yue-HK-Chirp3-HD-Aoede', languageCodes: ['yue-HK'] },
        'zh'
      )
    ).toBe(false);
    expect(
      gcpVoiceMatchesListenLanguage(
        { name: 'yue-HK-Chirp3-HD-Aoede', languageCodes: ['yue-HK'] },
        'yue'
      )
    ).toBe(true);
    expect(
      gcpVoiceMatchesListenLanguage({ name: 'es-US-Neural2-A', languageCodes: ['es-US'] }, 'zh')
    ).toBe(false);
  });

  it('matches Filipino voices for tl', () => {
    expect(
      gcpVoiceMatchesListenLanguage({ name: 'fil-PH-Standard-A', languageCodes: ['fil-PH'] }, 'tl')
    ).toBe(true);
  });
});

describe('voiceMatchesListenLanguage', () => {
  it('accepts yue-HK for Cantonese listen language only', () => {
    expect(voiceMatchesListenLanguage('yue-HK-Chirp3-HD-Aoede', 'yue')).toBe(true);
    expect(voiceMatchesListenLanguage('yue-HK-Chirp3-HD-Aoede', 'zh')).toBe(false);
  });
});
