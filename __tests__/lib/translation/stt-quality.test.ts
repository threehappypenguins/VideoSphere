import { describe, expect, it } from 'vitest';
import {
  isLikelyWhisperHallucination,
  isNearSilentPcm16,
  pcm16MonoPeak,
  pcm16MonoRms,
  sanitizeSttTranscript,
} from '@/lib/translation/stt-quality';

/**
 * Builds a mono PCM16 LE buffer filled with a constant sample value.
 * @param sampleCount - Number of samples.
 * @param sample - Int16 sample value.
 * @returns PCM buffer.
 */
function pcmConstant(sampleCount: number, sample: number): Buffer {
  const buf = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i += 1) {
    buf.writeInt16LE(sample, i * 2);
  }
  return buf;
}

describe('pcm16MonoRms / peak', () => {
  it('returns 0 for empty pcm', () => {
    expect(pcm16MonoRms(Buffer.alloc(0))).toBe(0);
    expect(pcm16MonoPeak(Buffer.alloc(0))).toBe(0);
  });

  it('detects near-silent buffers', () => {
    expect(isNearSilentPcm16(pcmConstant(1600, 0))).toBe(true);
    expect(isNearSilentPcm16(pcmConstant(1600, 20))).toBe(true);
  });

  it('keeps loud speech-like buffers', () => {
    // ~0.3 peak — well above silence gates.
    expect(isNearSilentPcm16(pcmConstant(1600, 10_000))).toBe(false);
  });
});

describe('sanitizeSttTranscript / hallucinations', () => {
  it('drops classic Whisper silence fillers', () => {
    expect(sanitizeSttTranscript('Thank you.')).toBe('');
    expect(sanitizeSttTranscript('Thanks for watching!')).toBe('');
    expect(sanitizeSttTranscript('...')).toBe('');
    expect(isLikelyWhisperHallucination('Thank you')).toBe(true);
  });

  it('keeps real sentences that mention thanks', () => {
    expect(sanitizeSttTranscript('Thank you for joining us today.')).toBe(
      'Thank you for joining us today.'
    );
    expect(sanitizeSttTranscript('We thank God for His mercy.')).toBe(
      'We thank God for His mercy.'
    );
  });

  it('drops prompt leakage and repetitive decoder loops', () => {
    expect(
      sanitizeSttTranscript(
        'Tonscribe only clear speech. Transcribe only clear speech. Transhi. Transhi. Transhi. Transhi.'
      )
    ).toBe('');
    expect(
      sanitizeSttTranscript(
        'Tonshi. Tonshi. Tonshi. Tonshi. Tonshi. Tonshi. Tonshi. Tonshi. Tonshi. Tonshi.'
      )
    ).toBe('');
  });
});
