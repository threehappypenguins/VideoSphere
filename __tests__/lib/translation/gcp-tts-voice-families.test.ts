/**
 * Tests for GCP TTS voice family classification and catalog helpers.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyGcpTtsVoiceFamily,
  gcpTtsVoiceFamiliesInCatalog,
  gcpTtsVoiceFamilyInfo,
  inferGcpTtsVoiceFamily,
} from '@/lib/translation/gcp-tts-voice-families';

describe('classifyGcpTtsVoiceFamily', () => {
  it('classifies Chirp 3 HD, Neural2, WaveNet, Standard, Studio, Polyglot', () => {
    expect(classifyGcpTtsVoiceFamily('en-US-Chirp3-HD-Aoede')).toBe('chirp3-hd');
    expect(classifyGcpTtsVoiceFamily('es-US-Neural2-A')).toBe('neural2');
    expect(classifyGcpTtsVoiceFamily('fr-FR-Wavenet-B')).toBe('wavenet');
    expect(classifyGcpTtsVoiceFamily('de-DE-Standard-A')).toBe('standard');
    expect(classifyGcpTtsVoiceFamily('en-US-Studio-O')).toBe('studio');
    expect(classifyGcpTtsVoiceFamily('en-US-Polyglot-1')).toBe('polyglot');
  });

  it('returns other for unrecognized names', () => {
    expect(classifyGcpTtsVoiceFamily('en-US-Mystery-A')).toBe('other');
    expect(classifyGcpTtsVoiceFamily('')).toBe('other');
  });
});

describe('gcpTtsVoiceFamilyInfo', () => {
  it('exposes free usage limits for Standard and Chirp 3 HD', () => {
    expect(gcpTtsVoiceFamilyInfo('standard').freeUsageLimit).toMatch(/4 million/i);
    expect(gcpTtsVoiceFamilyInfo('chirp3-hd').freeUsageLimit).toMatch(/1 million/i);
  });
});

describe('gcpTtsVoiceFamiliesInCatalog', () => {
  it('returns unique families sorted by preferred order', () => {
    const families = gcpTtsVoiceFamiliesInCatalog([
      'en-US-Chirp3-HD-Aoede',
      'en-US-Standard-A',
      'es-US-Neural2-A',
      'en-US-Standard-B',
    ]);
    expect(families.map((f) => f.id)).toEqual(['standard', 'neural2', 'chirp3-hd']);
  });
});

describe('inferGcpTtsVoiceFamily', () => {
  it('returns shared family or null when mixed/empty', () => {
    expect(inferGcpTtsVoiceFamily(['en-US-Neural2-A', 'es-US-Neural2-B'])).toBe('neural2');
    expect(inferGcpTtsVoiceFamily(['en-US-Neural2-A', 'es-US-Wavenet-A'])).toBeNull();
    expect(inferGcpTtsVoiceFamily([])).toBeNull();
  });
});
