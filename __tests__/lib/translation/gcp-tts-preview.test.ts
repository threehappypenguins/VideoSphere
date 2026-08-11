/**
 * Tests for short GCP TTS preview sample phrases.
 */
import { describe, expect, it } from 'vitest';
import {
  GCP_TTS_PREVIEW_FALLBACK_TEXT,
  gcpTtsPreviewTextForLanguage,
} from '@/lib/translation/gcp-tts-preview';

describe('gcpTtsPreviewTextForLanguage', () => {
  it('returns language-specific samples for Mandarin and Cantonese', () => {
    expect(gcpTtsPreviewTextForLanguage('zh')).toMatch(/你好/);
    expect(gcpTtsPreviewTextForLanguage('yue')).toMatch(/你好/);
    expect(gcpTtsPreviewTextForLanguage('zh')).not.toBe(gcpTtsPreviewTextForLanguage('yue'));
  });

  it('falls back to English for unknown codes', () => {
    expect(gcpTtsPreviewTextForLanguage('xx-unknown')).toBe(GCP_TTS_PREVIEW_FALLBACK_TEXT);
  });
});
