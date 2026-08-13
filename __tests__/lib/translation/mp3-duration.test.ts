// =============================================================================
// Tests for lib/translation/mp3-duration
// =============================================================================
// Frames are hand-built rather than fixtured so the expected duration is arithmetic
// rather than a magic number, and so both the MPEG1 and MPEG2 (half-rate) layouts that
// GCP TTS can return are covered.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { mp3DurationMs } from '@/lib/translation/mp3-duration';

/** MPEG1 Layer III, 44100 Hz, 128 kbps, mono: 417-byte frames of 1152 samples. */
const MPEG1_HEADER = [0xff, 0xfb, 0x90, 0xc4] as const;
const MPEG1_FRAME_BYTES = 417;
const MPEG1_FRAME_MS = (1152 / 44100) * 1000;

/** MPEG2 Layer III, 24000 Hz, 32 kbps, mono: 96-byte frames of 576 samples. */
const MPEG2_HEADER = [0xff, 0xf3, 0x44, 0xc4] as const;
const MPEG2_FRAME_BYTES = 96;
const MPEG2_FRAME_MS = (576 / 24000) * 1000;

/**
 * Builds a run of identical silent frames.
 * @param header - Four header bytes.
 * @param frameBytes - Total frame size including the header.
 * @param count - Number of frames.
 * @returns Concatenated frames.
 */
function frames(header: readonly number[], frameBytes: number, count: number): Buffer {
  const frame = Buffer.alloc(frameBytes);
  Buffer.from(header).copy(frame, 0);
  return Buffer.concat(Array.from({ length: count }, () => frame));
}

/**
 * Builds an ID3v2 tag of a given body size.
 * @param bodySize - Bytes of tag body to declare and allocate.
 * @returns Tag header plus zeroed body.
 */
function id3v2Tag(bodySize: number): Buffer {
  const tag = Buffer.alloc(10 + bodySize);
  tag.write('ID3', 0, 'ascii');
  tag[3] = 0x03;
  // Synchsafe size: seven significant bits per byte.
  tag[6] = (bodySize >> 21) & 0x7f;
  tag[7] = (bodySize >> 14) & 0x7f;
  tag[8] = (bodySize >> 7) & 0x7f;
  tag[9] = bodySize & 0x7f;
  return tag;
}

describe('mp3DurationMs', () => {
  it('sums constant-bitrate MPEG1 Layer III frames', () => {
    const bytes = frames(MPEG1_HEADER, MPEG1_FRAME_BYTES, 100);
    expect(mp3DurationMs(bytes)).toBeCloseTo(MPEG1_FRAME_MS * 100, 6);
  });

  it('halves the samples per frame for MPEG2 Layer III', () => {
    const bytes = frames(MPEG2_HEADER, MPEG2_FRAME_BYTES, 50);
    expect(mp3DurationMs(bytes)).toBeCloseTo(MPEG2_FRAME_MS * 50, 6);
  });

  it('reports a realistic clip length for a ten-second stream', () => {
    const count = Math.round(10_000 / MPEG2_FRAME_MS);
    const bytes = frames(MPEG2_HEADER, MPEG2_FRAME_BYTES, count);
    // Duration is quantised to whole frames, so land within one frame of ten seconds.
    expect(mp3DurationMs(bytes)).toBeGreaterThan(10_000 - MPEG2_FRAME_MS);
    expect(mp3DurationMs(bytes)).toBeLessThan(10_000 + MPEG2_FRAME_MS);
  });

  it('skips a leading ID3v2 tag', () => {
    const audio = frames(MPEG1_HEADER, MPEG1_FRAME_BYTES, 20);
    const withTag = Buffer.concat([id3v2Tag(512), audio]);
    expect(mp3DurationMs(withTag)).toBeCloseTo(mp3DurationMs(audio), 6);
  });

  it('ignores an ID3v2 tag whose declared size runs past the buffer', () => {
    expect(mp3DurationMs(id3v2Tag(64).subarray(0, 10))).toBe(0);
  });

  it('sums variable-bitrate streams frame by frame', () => {
    // Same sample rate, different bitrates: duration depends only on frame count.
    const lowBitrate = frames([0xff, 0xfb, 0x50, 0xc4], 208, 10); // 64 kbps, 44100 Hz
    const highBitrate = frames(MPEG1_HEADER, MPEG1_FRAME_BYTES, 10); // 128 kbps
    const bytes = Buffer.concat([lowBitrate, highBitrate]);
    expect(mp3DurationMs(bytes)).toBeCloseTo(MPEG1_FRAME_MS * 20, 6);
  });

  it('tallies each run separately when the sample rate changes mid-stream', () => {
    const bytes = Buffer.concat([
      frames(MPEG1_HEADER, MPEG1_FRAME_BYTES, 10),
      frames(MPEG2_HEADER, MPEG2_FRAME_BYTES, 10),
    ]);
    expect(mp3DurationMs(bytes)).toBeCloseTo(MPEG1_FRAME_MS * 10 + MPEG2_FRAME_MS * 10, 6);
  });

  it('tolerates a trailing ID3v1 tag', () => {
    const audio = frames(MPEG1_HEADER, MPEG1_FRAME_BYTES, 20);
    const id3v1 = Buffer.alloc(128);
    id3v1.write('TAG', 0, 'ascii');
    expect(mp3DurationMs(Buffer.concat([audio, id3v1]))).toBeCloseTo(MPEG1_FRAME_MS * 20, 6);
  });

  it('resynchronises after junk between frames', () => {
    const bytes = Buffer.concat([
      frames(MPEG1_HEADER, MPEG1_FRAME_BYTES, 5),
      Buffer.alloc(37, 0x5a),
      frames(MPEG1_HEADER, MPEG1_FRAME_BYTES, 5),
    ]);
    expect(mp3DurationMs(bytes)).toBeCloseTo(MPEG1_FRAME_MS * 10, 6);
  });

  it('returns 0 for empty input', () => {
    expect(mp3DurationMs(Buffer.alloc(0))).toBe(0);
  });

  it('returns 0 when no frame sync is present', () => {
    expect(mp3DurationMs(Buffer.alloc(2048, 0x11))).toBe(0);
  });

  it('rejects reserved and free-format headers', () => {
    // Reserved MPEG version (bits 20-19 = 01).
    expect(mp3DurationMs(Buffer.from([0xff, 0xeb, 0x90, 0xc4, 0x00, 0x00]))).toBe(0);
    // Reserved layer (bits 18-17 = 00).
    expect(mp3DurationMs(Buffer.from([0xff, 0xf9, 0x90, 0xc4, 0x00, 0x00]))).toBe(0);
    // Free-format bitrate index 0.
    expect(mp3DurationMs(Buffer.from([0xff, 0xfb, 0x00, 0xc4, 0x00, 0x00]))).toBe(0);
    // Invalid bitrate index 15.
    expect(mp3DurationMs(Buffer.from([0xff, 0xfb, 0xf0, 0xc4, 0x00, 0x00]))).toBe(0);
    // Reserved sample-rate index 3.
    expect(mp3DurationMs(Buffer.from([0xff, 0xfb, 0x9c, 0xc4, 0x00, 0x00]))).toBe(0);
  });
});
