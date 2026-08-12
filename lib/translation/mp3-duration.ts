// =============================================================================
// MP3 playback duration from raw bytes (MPEG audio frame headers)
// =============================================================================
// GCP TTS returns MP3 bytes with no duration metadata, and the server has no audio
// element to ask. Frame headers carry everything needed: walking them and summing
// samples/sampleRate yields the exact playback duration, including VBR streams.
//
// Needed because the spoken-lag instrumentation compares how long a translated clip
// takes to speak against the source speech it replaces — a ratio above 1 is what makes
// TTS fall progressively further behind the preacher.
// =============================================================================

/** Sample rates in Hz by MPEG version id, indexed by the header's sample-rate index. */
const SAMPLE_RATES: Readonly<Record<MpegVersion, readonly [number, number, number]>> = {
  mpeg1: [44100, 48000, 32000],
  mpeg2: [22050, 24000, 16000],
  mpeg25: [11025, 12000, 8000],
};

/** Bitrates in kbps indexed by the header's 4-bit bitrate index (0 = free, 15 = invalid). */
const BITRATES = {
  mpeg1: {
    1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0],
    2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0],
    3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  },
  // MPEG2 and MPEG2.5 share one table.
  mpeg2: {
    1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
    3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
  },
} as const satisfies Record<'mpeg1' | 'mpeg2', Record<MpegLayer, readonly number[]>>;

/** MPEG audio version encoded in bits 20-19 of the frame header. */
type MpegVersion = 'mpeg1' | 'mpeg2' | 'mpeg25';

/** MPEG audio layer (1 = Layer I, 3 = Layer III). */
type MpegLayer = 1 | 2 | 3;

/** One decoded MPEG audio frame header. */
interface FrameHeader {
  /** Total frame size in bytes, including the 4-byte header and any padding slot. */
  byteLength: number;
  /** PCM samples this frame decodes to. */
  sampleCount: number;
  /** Output sample rate in Hz. */
  sampleRate: number;
}

/**
 * Skips a leading ID3v2 tag, which precedes the first audio frame.
 * @param bytes - Full MP3 byte stream.
 * @returns Offset of the first byte that may begin an audio frame.
 */
function audioStartOffset(bytes: Uint8Array): number {
  const hasId3 = bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
  if (!hasId3) return 0;
  // Size is four synchsafe bytes (7 significant bits each) covering the tag body only.
  const size =
    ((bytes[6]! & 0x7f) << 21) |
    ((bytes[7]! & 0x7f) << 14) |
    ((bytes[8]! & 0x7f) << 7) |
    (bytes[9]! & 0x7f);
  return Math.min(bytes.length, 10 + size);
}

/**
 * Decodes the MPEG audio frame header at an offset.
 * @param bytes - Full MP3 byte stream.
 * @param offset - Candidate frame start.
 * @returns Decoded header, or null when the bytes are not a valid frame header.
 */
function decodeFrameHeader(bytes: Uint8Array, offset: number): FrameHeader | null {
  if (offset + 4 > bytes.length) return null;

  const b0 = bytes[offset]!;
  const b1 = bytes[offset + 1]!;
  const b2 = bytes[offset + 2]!;

  // 11-bit frame sync.
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return null;

  const versionBits = (b1 >> 3) & 0x03;
  if (versionBits === 0x01) return null; // reserved
  const version: MpegVersion =
    versionBits === 0x03 ? 'mpeg1' : versionBits === 0x02 ? 'mpeg2' : 'mpeg25';

  const layerBits = (b1 >> 1) & 0x03;
  if (layerBits === 0x00) return null; // reserved
  const layer: MpegLayer = layerBits === 0x03 ? 1 : layerBits === 0x02 ? 2 : 3;

  const bitrateIndex = (b2 >> 4) & 0x0f;
  if (bitrateIndex === 0x00 || bitrateIndex === 0x0f) return null; // free / invalid

  const sampleRateIndex = (b2 >> 2) & 0x03;
  if (sampleRateIndex === 0x03) return null; // reserved

  const sampleRate = SAMPLE_RATES[version][sampleRateIndex as 0 | 1 | 2];
  const bitrateKbps = BITRATES[version === 'mpeg1' ? 'mpeg1' : 'mpeg2'][layer][bitrateIndex]!;
  const padding = (b2 >> 1) & 0x01;

  // Layer I carries 384 samples; Layer II always 1152; Layer III 1152 on MPEG1 but 576
  // on the half-rate MPEG2/2.5 variants.
  const sampleCount = layer === 1 ? 384 : layer === 2 ? 1152 : version === 'mpeg1' ? 1152 : 576;

  // Layer I measures padding in 4-byte slots; Layers II and III in single bytes.
  const byteLength =
    layer === 1
      ? (Math.floor((12 * bitrateKbps * 1000) / sampleRate) + padding) * 4
      : Math.floor((sampleCount / 8) * ((bitrateKbps * 1000) / sampleRate)) + padding;

  if (byteLength <= 4) return null;
  return { byteLength, sampleCount, sampleRate };
}

/**
 * Measures the playback duration of an MP3 byte stream.
 *
 * Walks MPEG audio frame headers and sums each frame's samples over its sample rate, so
 * constant- and variable-bitrate streams are both handled. Any Xing/Info header frame is
 * counted as the ordinary (silent) frame it is, worth well under one percent of a clip.
 * @param bytes - Raw MP3 bytes, optionally preceded by an ID3v2 tag.
 * @returns Duration in milliseconds, or 0 when no valid frame is found.
 */
export function mp3DurationMs(bytes: Uint8Array): number {
  let offset = audioStartOffset(bytes);
  let samples = 0;
  let sampleRate = 0;
  let durationMs = 0;

  while (offset < bytes.length) {
    const header = decodeFrameHeader(bytes, offset);
    if (!header) {
      // Lost sync (trailing ID3v1 tag, junk, or a corrupt frame). Scan for the next one.
      offset += 1;
      continue;
    }

    // Mixed sample rates are legal across frames; bank the tally before switching.
    if (sampleRate !== 0 && header.sampleRate !== sampleRate) {
      durationMs += (samples / sampleRate) * 1000;
      samples = 0;
    }
    sampleRate = header.sampleRate;
    samples += header.sampleCount;
    offset += header.byteLength;
  }

  if (sampleRate !== 0) durationMs += (samples / sampleRate) * 1000;
  return durationMs;
}
