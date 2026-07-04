import { join } from 'node:path';
import { rm, writeFile } from 'node:fs/promises';
import { probeNearbyKeyframes } from '@/lib/youtube-import/probe-keyframes';
import {
  runSpawnWithCancel,
  YoutubeImportJobCancelledError,
} from '@/lib/youtube-import/spawn-with-cancel';
import { spawnProcess } from '@/lib/youtube-import/spawn-process';

/** Treat timestamps within this distance as sitting on a keyframe. */
const KEYFRAME_EPSILON_SECONDS = 0.05;

/** Fallback audio sample rate when ffprobe cannot read the source stream rate. */
const SMART_CUT_DEFAULT_AUDIO_SAMPLE_RATE = 44_100;

/** Common broadcast frame rates used to normalize ffprobe output. */
const STANDARD_FRAME_RATES = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60] as const;

/**
 * How far back to fast-seek (input-level `-ss`) before decoding the head segment.
 * Only needs to clear one GOP; padded generously since YouTube live replays can have
 * sparse keyframes. Combined with `-copyts`, landing earlier than necessary is harmless —
 * the trim filter discards everything before the real start.
 */
const HEAD_SEGMENT_SEEK_PAD_SECONDS = 15;

/**
 * Parses an ffprobe `avg_frame_rate` value such as `30/1` or `30000/1001`.
 * @param raw - Raw ffprobe frame-rate string.
 * @returns Parsed fps, or null when the value is missing or invalid.
 */
export function parseVideoFrameRate(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '0/0') {
    return null;
  }

  const [numeratorRaw, denominatorRaw] = trimmed.split('/');
  const numerator = Number(numeratorRaw);
  const denominator = Number(denominatorRaw);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }

  const fps = numerator / denominator;
  if (!Number.isFinite(fps) || fps <= 0) {
    return null;
  }

  return Math.round(fps * 1000) / 1000;
}

/**
 * Snaps a measured fps to a nearby standard broadcast rate when close enough.
 * @param fps - Parsed frame rate.
 * @returns Normalized frame rate.
 */
export function normalizeStandardFrameRate(fps: number): number {
  for (const standard of STANDARD_FRAME_RATES) {
    if (Math.abs(fps - standard) < 0.01) {
      return standard;
    }
  }

  return Math.round(fps * 1000) / 1000;
}

/**
 * Chooses a smart-cut output frame rate from ffprobe stream metadata.
 * YouTube live replays often report a low `avg_frame_rate` even when `r_frame_rate`
 * is 30 fps, so prefer `r_frame_rate` when the two disagree sharply.
 * @param rFrameRate - Raw `r_frame_rate` from ffprobe.
 * @param avgFrameRate - Raw `avg_frame_rate` from ffprobe.
 * @returns Target constant output frame rate.
 */
export function resolveSmartCutFrameRate(
  rFrameRate: string | null | undefined,
  avgFrameRate: string | null | undefined
): number {
  return parseVideoFrameRate(resolveSmartCutFrameRateRational(rFrameRate, avgFrameRate)) ?? 30;
}

/**
 * Chooses the rational frame rate used for smart-cut encode segments.
 * Prefer the source `r_frame_rate` so the re-encoded head matches stream-copy timing.
 * @param rFrameRate - Raw `r_frame_rate` from ffprobe.
 * @param avgFrameRate - Raw `avg_frame_rate` from ffprobe.
 * @returns Rational fps string such as `30000/1001` or `30/1`.
 */
export function resolveSmartCutFrameRateRational(
  rFrameRate: string | null | undefined,
  avgFrameRate: string | null | undefined
): string {
  const r = rFrameRate?.trim();
  const avg = avgFrameRate?.trim();
  const rFps = r && r !== '0/0' ? parseVideoFrameRate(r) : null;
  const avgFps = avg && avg !== '0/0' ? parseVideoFrameRate(avg) : null;

  if (rFps != null && avgFps != null && avgFps < rFps * 0.75) {
    return r!;
  }

  if (rFps != null && avgFps != null && avgFps > rFps) {
    return avg!;
  }

  if (rFps != null) {
    return r!;
  }

  if (avgFps != null) {
    return avg!;
  }

  return '30/1';
}

/**
 * Parses an ffprobe audio sample-rate field.
 * @param raw - Raw ffprobe sample-rate string.
 * @returns Parsed sample rate in Hz, or null when invalid.
 */
export function parseAudioSampleRate(raw: string): number | null {
  const sampleRate = Number(raw.trim());
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    return null;
  }

  return Math.round(sampleRate);
}

/**
 * Builds libx264 arguments shared by every smart-cut encode (head segments and
 * whole-selection encodes for cuts that never leave a single GOP).
 * A large GOP + no B-frames + disabled scene-cut detection guarantees the encoded
 * segment contains exactly one keyframe (its first frame), which is what makes it
 * safe to concatenate with a stream-copied continuation.
 * @param frameRateRational - Target output frame rate as an ffprobe-style rational.
 * @returns ffmpeg video-encoding argument list.
 */
export function buildSmartCutVideoEncodeArgs(frameRateRational: string): string[] {
  return [
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-r',
    frameRateRational,
    '-fps_mode',
    'cfr',
    '-g',
    '9999',
    '-keyint_min',
    '9999',
    '-sc_threshold',
    '0',
    '-x264-params',
    'bframes=0:open-gop=0',
  ];
}

/**
 * Formats a timestamp for ffmpeg filter expressions.
 * @param seconds - Timestamp in seconds.
 * @returns Filter-safe seconds literal.
 */
export function formatFilterSeconds(seconds: number): string {
  return (Math.round(seconds * 1_000_000) / 1_000_000).toFixed(6);
}

/**
 * Builds shared AAC encode arguments for smart-cut audio output.
 * @param audioSampleRate - Target audio sample rate in Hz.
 * @returns ffmpeg audio-encoding argument list.
 */
export function buildSmartCutAudioEncodeArgs(audioSampleRate: number): string[] {
  return ['-c:a', 'aac', '-b:a', '192k', '-ar', String(audioSampleRate)];
}

/**
 * Builds a video-only trim filter graph for smart-cut encode segments.
 * @param startSeconds - Trim start in seconds within the source file (absolute, since
 * the caller runs the source with `-copyts`).
 * @param endSeconds - Trim end in seconds within the source file (exclusive).
 * @param options - Optional graph settings.
 * @param options.rebaseTimestamps - When true (default), rebases PTS to zero after trim.
 * @returns ffmpeg `-filter_complex` graph string.
 */
export function buildSmartCutVideoTrimFilterGraph(
  startSeconds: number,
  endSeconds: number,
  options?: { rebaseTimestamps?: boolean }
): string {
  const start = formatFilterSeconds(startSeconds);
  const end = formatFilterSeconds(endSeconds);
  const rebase = options?.rebaseTimestamps !== false ? ',setpts=PTS-STARTPTS' : '';

  return `[0:v]trim=start=${start}:end=${end}${rebase}[v]`;
}

/**
 * Builds an audio-only trim filter graph for the decoupled smart-cut audio track.
 * @param startSeconds - Trim start in seconds within the source file (absolute, since
 * the caller runs the source with `-copyts`).
 * @param endSeconds - Trim end in seconds within the source file (exclusive).
 * @returns ffmpeg `-filter_complex` graph string.
 */
export function buildSmartCutAudioTrimFilterGraph(
  startSeconds: number,
  endSeconds: number
): string {
  const start = formatFilterSeconds(startSeconds);
  const end = formatFilterSeconds(endSeconds);

  return `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a]`;
}

/**
 * Builds a frame-accurate trim filter graph for a single-pass encode segment.
 * @param startSeconds - Trim start in seconds within the source file (absolute, since
 * the caller runs the source with `-copyts`).
 * @param endSeconds - Trim end in seconds within the source file (exclusive).
 * @returns ffmpeg `-filter_complex` graph string.
 */
export function buildSmartCutTrimFilterGraph(startSeconds: number, endSeconds: number): string {
  return `${buildSmartCutVideoTrimFilterGraph(startSeconds, endSeconds)};${buildSmartCutAudioTrimFilterGraph(startSeconds, endSeconds)}`;
}

/**
 * Returns true when a timestamp aligns with a known keyframe.
 * @param timestamp - Timestamp in seconds.
 * @param keyframes - Candidate keyframe timestamps in seconds.
 * @returns Whether the timestamp is on a keyframe.
 */
export function isOnKeyframe(timestamp: number, keyframes: number[]): boolean {
  return keyframes.some((keyframe) => Math.abs(keyframe - timestamp) < KEYFRAME_EPSILON_SECONDS);
}

/**
 * Finds the next keyframe strictly after a timestamp.
 * @param timestamp - Reference timestamp in seconds.
 * @param keyframes - Candidate keyframe timestamps in seconds.
 * @returns Next keyframe timestamp, or null when none exist.
 */
export function findNextKeyframeAfter(timestamp: number, keyframes: number[]): number | null {
  const sorted = [...new Set(keyframes.filter(Number.isFinite))].sort((a, b) => a - b);
  for (const keyframe of sorted) {
    if (keyframe > timestamp + KEYFRAME_EPSILON_SECONDS) {
      return keyframe;
    }
  }
  return null;
}

/**
 * Finds the last keyframe at or before a timestamp.
 * @param timestamp - Reference timestamp in seconds.
 * @param keyframes - Candidate keyframe timestamps in seconds.
 * @returns Nearest keyframe at or before the timestamp, or null when none exist.
 */
export function findKeyframeAtOrBefore(timestamp: number, keyframes: number[]): number | null {
  const sorted = [...new Set(keyframes.filter(Number.isFinite))].sort((a, b) => a - b);
  let candidate: number | null = null;
  for (const keyframe of sorted) {
    if (keyframe <= timestamp + KEYFRAME_EPSILON_SECONDS) {
      candidate = keyframe;
      continue;
    }
    break;
  }
  return candidate;
}

function logSmartCutPlan(
  plan: SmartCutPlan,
  keyframes: number[],
  trimStart: number,
  trimEnd: number
): void {
  const payload: Record<string, unknown> = {
    kind: plan.kind,
    trimStart,
    trimEnd,
    probedKeyframes: keyframes,
  };

  if (plan.kind === 'encode-then-copy') {
    const keyframeAtCopyStart = findKeyframeAtOrBefore(plan.copyStart, keyframes);
    payload.encodeStart = plan.encodeStart;
    payload.encodeEnd = plan.encodeEnd;
    payload.copyStart = plan.copyStart;
    payload.copyEnd = plan.copyEnd;
    payload.keyframeAtOrBeforeCopyStart = keyframeAtCopyStart;
    payload.copyStartMatchesProbedKeyframe =
      keyframeAtCopyStart !== null &&
      Math.abs(keyframeAtCopyStart - plan.copyStart) < KEYFRAME_EPSILON_SECONDS;
  }

  console.log('[smart-cut] plan', JSON.stringify(payload));
}

/**
 * One trim plan produced by {@link planSmartCut}.
 *
 * `copy` — both boundaries are already keyframe-aligned (or close enough); a single
 * stream copy handles the whole range. No re-encode, no join.
 *
 * `encode` — the whole selection sits inside a single GOP (no keyframe between start
 * and end). It's re-encoded whole, but since it's at most one GOP (a few seconds on
 * typical livestream encodes) this is cheap regardless of how long the overall clip is.
 *
 * `encode-then-copy` — the general case. Only the small head span from the requested
 * start up to the next keyframe is re-encoded; everything from that keyframe to the
 * requested end is a pure stream copy. Audio is stream-copied once for the full trim
 * range and muxed at the end.
 */
export type SmartCutPlan =
  | { kind: 'copy'; startSeconds: number; endSeconds: number }
  | { kind: 'encode'; startSeconds: number; endSeconds: number }
  | {
      kind: 'encode-then-copy';
      encodeStart: number;
      encodeEnd: number;
      copyStart: number;
      copyEnd: number;
    };

/**
 * Plans a frame-accurate trim without re-encoding the full clip.
 *
 * Only the *start* of a cut needs a keyframe: decoding can't begin mid-GOP without one.
 * The *end* of a cut has no such requirement — stream-copying can stop at any frame,
 * since every frame already copied has everything it needs to decode correctly. That
 * asymmetry is why this plan never needs more than one encoded segment: re-encode the
 * head up to the next keyframe, then stream-copy everything after that keyframe straight
 * through to the requested end, however far away it is.
 * @param startSeconds - Desired trim start in seconds within the source file.
 * @param endSeconds - Desired trim end in seconds within the source file.
 * @param keyframes - Known keyframe timestamps in seconds within the source file.
 * @returns The trim plan.
 */
export function planSmartCut(
  startSeconds: number,
  endSeconds: number,
  keyframes: number[]
): SmartCutPlan {
  if (endSeconds <= startSeconds) {
    throw new Error('endSeconds must be greater than startSeconds');
  }

  const knownKeyframes = [...new Set(keyframes.filter(Number.isFinite))].sort((a, b) => a - b);

  if (isOnKeyframe(startSeconds, knownKeyframes)) {
    return { kind: 'copy', startSeconds, endSeconds };
  }

  const nextKeyframe = findNextKeyframeAfter(startSeconds, knownKeyframes);
  if (nextKeyframe == null || nextKeyframe >= endSeconds) {
    return { kind: 'encode', startSeconds, endSeconds };
  }

  return {
    kind: 'encode-then-copy',
    encodeStart: startSeconds,
    encodeEnd: nextKeyframe,
    copyStart: nextKeyframe,
    copyEnd: endSeconds,
  };
}

async function throwIfCancelled(isCancelled?: () => Promise<boolean>): Promise<void> {
  if (await isCancelled?.()) {
    throw new YoutubeImportJobCancelledError();
  }
}

async function runFfmpeg(
  args: readonly string[],
  label: string,
  options?: { isCancelled?: () => Promise<boolean> }
): Promise<void> {
  await runSpawnWithCancel('ffmpeg', args, label, options);
}

type SmartCutSourceMediaParams = {
  frameRateRational: string;
  audioSampleRate: number;
};

/**
 * Last decodable timestamp per stream in a local media file.
 * @property videoEndSeconds - End of the video stream in seconds, or null when unknown.
 * @property audioEndSeconds - End of the audio stream in seconds, or null when unknown.
 */
export type SmartCutSourceStreamBounds = {
  videoEndSeconds: number | null;
  audioEndSeconds: number | null;
};

/**
 * Parses the end timestamp of an ffprobe stream entry (`start_time + duration`).
 * @param stream - ffprobe stream object.
 * @returns End timestamp in seconds, or null when unavailable.
 */
export function parseStreamEndSeconds(stream: Record<string, string> | undefined): number | null {
  if (!stream) {
    return null;
  }

  const duration = Number(stream.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    return null;
  }

  const startTime = Number(stream.start_time ?? 0);
  const startSeconds = Number.isFinite(startTime) && startTime > 0 ? startTime : 0;
  return startSeconds + duration;
}

/**
 * Clamps a trim end to the shorter of the requested end and available A/V stream bounds.
 * @param relativeStart - Trim start in seconds within the source file.
 * @param relativeEnd - Requested trim end in seconds within the source file.
 * @param bounds - Probed stream end timestamps.
 * @returns Trim end that both streams can cover.
 */
export function resolveEffectiveTrimEnd(
  relativeStart: number,
  relativeEnd: number,
  bounds: SmartCutSourceStreamBounds
): number {
  const candidates = [relativeEnd];
  if (bounds.videoEndSeconds != null) {
    candidates.push(bounds.videoEndSeconds);
  }
  if (bounds.audioEndSeconds != null) {
    candidates.push(bounds.audioEndSeconds);
  }

  const effectiveEnd = Math.min(...candidates);
  if (!Number.isFinite(effectiveEnd) || effectiveEnd <= relativeStart) {
    throw new Error('Trim range is empty after clamping to source stream bounds');
  }

  return effectiveEnd;
}

/**
 * Reads frame rate, audio sample rate, and per-stream end timestamps from a media file.
 * @param mediaPath - Local media file path.
 * @returns Parsed media parameters with smart-cut defaults as fallback.
 */
async function probeSourceMediaParams(
  mediaPath: string
): Promise<SmartCutSourceMediaParams & SmartCutSourceStreamBounds> {
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawnProcess(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type,r_frame_rate,avg_frame_rate,sample_rate,start_time,duration',
        '-of',
        'json',
        mediaPath,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe media lookup failed (exit ${code ?? 'unknown'})`));
        return;
      }
      resolve(Buffer.concat(chunks).toString('utf8').trim());
    });
    child.on('error', reject);
  });

  let parsed: { streams?: Array<Record<string, string>> } = {};
  try {
    parsed = JSON.parse(stdout) as { streams?: Array<Record<string, string>> };
  } catch {
    parsed = {};
  }

  const streams = parsed.streams ?? [];
  const videoStream = streams.find((stream) => stream.codec_type === 'video');
  const audioStream = streams.find((stream) => stream.codec_type === 'audio');

  return {
    frameRateRational: resolveSmartCutFrameRateRational(
      videoStream?.r_frame_rate,
      videoStream?.avg_frame_rate
    ),
    audioSampleRate:
      parseAudioSampleRate(audioStream?.sample_rate ?? '') ?? SMART_CUT_DEFAULT_AUDIO_SAMPLE_RATE,
    videoEndSeconds: parseStreamEndSeconds(videoStream),
    audioEndSeconds: parseStreamEndSeconds(audioStream),
  };
}

/**
 * Builds ffmpeg arguments for a plain stream-copy trim, written directly to MP4.
 * Used when both boundaries are already keyframe-aligned — no encode, no join needed.
 * @param inputPath - Source media path.
 * @param outputPath - Output media path.
 * @param startSeconds - Trim start in seconds within the source file.
 * @param endSeconds - Trim end in seconds within the source file.
 * @returns ffmpeg argument vector.
 */
export function buildSmartCutCopyOnlyArgs(
  inputPath: string,
  outputPath: string,
  startSeconds: number,
  endSeconds: number
): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-ss',
    String(startSeconds),
    '-i',
    inputPath,
    '-t',
    String(endSeconds - startSeconds),
    '-map',
    '0',
    '-c',
    'copy',
    '-reset_timestamps',
    '1',
    '-avoid_negative_ts',
    'make_zero',
    '-shortest',
    '-movflags',
    '+faststart',
    '-y',
    outputPath,
  ];
}

/**
 * Builds ffmpeg arguments for a whole-selection encode, written directly to MP4.
 * Used only when the requested range sits inside a single GOP (no keyframe in between),
 * so this always covers a short span — never the full clip — even for long selections.
 *
 * Uses a fast input-level seek (`-ss` before `-i`) so ffmpeg doesn't have to decode from
 * the start of a long source file just to reach a cut that starts deep into it, combined
 * with `-copyts` so the source's original absolute timestamps survive that seek — the
 * trim filter graph below then cuts on those same absolute timestamps regardless of
 * exactly which keyframe the fast seek actually landed on.
 * @param inputPath - Source media path.
 * @param outputPath - Output media path.
 * @param startSeconds - Trim start in seconds within the source file.
 * @param endSeconds - Trim end in seconds within the source file.
 * @param frameRateRational - Target fps as an ffprobe-style rational.
 * @param audioSampleRate - Target audio sample rate in Hz.
 * @returns ffmpeg argument vector.
 */
export function buildSmartCutEncodeOnlyArgs(
  inputPath: string,
  outputPath: string,
  startSeconds: number,
  endSeconds: number,
  frameRateRational: string,
  audioSampleRate: number
): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-ss',
    String(Math.max(0, startSeconds - HEAD_SEGMENT_SEEK_PAD_SECONDS)),
    '-copyts',
    '-i',
    inputPath,
    '-filter_complex',
    buildSmartCutTrimFilterGraph(startSeconds, endSeconds),
    '-map',
    '[v]',
    '-map',
    '[a]',
    ...buildSmartCutVideoEncodeArgs(frameRateRational),
    '-pix_fmt',
    'yuv420p',
    ...buildSmartCutAudioEncodeArgs(audioSampleRate),
    '-movflags',
    '+faststart',
    '-y',
    outputPath,
  ];
}

/**
 * Builds ffmpeg arguments for the re-encoded head segment of an `encode-then-copy` plan.
 * Output is video-only MP4 with PTS rebased to zero. Audio is handled separately.
 * @param inputPath - Source media path.
 * @param outputPath - Head segment `.mp4` output path.
 * @param encodeStart - Trim start in seconds within the source file.
 * @param encodeEnd - End of the head segment — the next keyframe at/after `encodeStart` (exclusive).
 * @param frameRateRational - Target fps as an ffprobe-style rational.
 * @returns ffmpeg argument vector.
 */
export function buildSmartCutHeadSegmentArgs(
  inputPath: string,
  outputPath: string,
  encodeStart: number,
  encodeEnd: number,
  frameRateRational: string
): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-ss',
    String(Math.max(0, encodeStart - HEAD_SEGMENT_SEEK_PAD_SECONDS)),
    '-copyts',
    '-i',
    inputPath,
    '-filter_complex',
    buildSmartCutVideoTrimFilterGraph(encodeStart, encodeEnd),
    '-map',
    '[v]',
    ...buildSmartCutVideoEncodeArgs(frameRateRational),
    '-pix_fmt',
    'yuv420p',
    '-an',
    '-y',
    outputPath,
  ];
}

/**
 * Computes the `-output_ts_offset` for a stream-copied continuation so its first
 * frame continues immediately after a rebased head segment.
 * @param encodeStart - Head segment trim start in seconds.
 * @param encodeEnd - Head segment trim end in seconds (copy boundary).
 * @param copyStart - Stream-copy start in seconds (normally equals `encodeEnd`).
 * @returns Timestamp offset in seconds for ffmpeg `-output_ts_offset`.
 */
export function computeSmartCutCopyTimestampOffset(
  encodeStart: number,
  encodeEnd: number,
  copyStart: number
): number {
  const headDurationSeconds = encodeEnd - encodeStart;
  return headDurationSeconds - copyStart;
}

/**
 * Builds ffmpeg arguments for the stream-copied video continuation of an `encode-then-copy`
 * plan. `copyStart` is a keyframe; `-output_ts_offset` shifts copied PTS so the segment
 * continues where the rebased head segment ends.
 * @param inputPath - Source media path.
 * @param outputPath - Copy segment `.mp4` output path.
 * @param encodeStart - Head segment trim start in seconds.
 * @param encodeEnd - Head segment trim end in seconds.
 * @param copyStart - Start of the copy segment — a known keyframe timestamp.
 * @param copyEnd - Trim end in seconds within the source file.
 * @returns ffmpeg argument vector.
 */
export function buildSmartCutCopySegmentArgs(
  inputPath: string,
  outputPath: string,
  encodeStart: number,
  encodeEnd: number,
  copyStart: number,
  copyEnd: number
): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-ss',
    String(copyStart),
    '-copyts',
    '-i',
    inputPath,
    '-t',
    String(copyEnd - copyStart),
    '-output_ts_offset',
    String(computeSmartCutCopyTimestampOffset(encodeStart, encodeEnd, copyStart)),
    '-map',
    '0:v:0',
    '-c:v',
    'copy',
    '-bsf:v',
    'dump_extra',
    '-an',
    '-y',
    outputPath,
  ];
}

/**
 * Builds ffmpeg arguments for one stream-copied audio track over the full trim range.
 * AAC has no GOP constraint — frame boundaries are short enough for trim accuracy
 * without re-encoding when the source is already AAC.
 * @param inputPath - Source media path.
 * @param outputPath - Output audio path (typically `.m4a`).
 * @param startSeconds - Trim start in seconds within the source file.
 * @param endSeconds - Trim end in seconds within the source file.
 * @returns ffmpeg argument vector.
 */
export function buildSmartCutAudioTrackArgs(
  inputPath: string,
  outputPath: string,
  startSeconds: number,
  endSeconds: number
): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-ss',
    String(startSeconds),
    '-i',
    inputPath,
    '-t',
    String(endSeconds - startSeconds),
    '-map',
    '0:a:0',
    '-c:a',
    'copy',
    '-vn',
    '-y',
    outputPath,
  ];
}

/**
 * Builds a concat demuxer list file body for joining smart-cut video segments.
 * @param segmentPaths - Ordered segment paths to concatenate.
 * @returns Contents for a concat demuxer list file.
 */
export function buildSmartCutConcatListContent(segmentPaths: readonly string[]): string {
  return segmentPaths
    .map((segmentPath) => `file '${segmentPath.replace(/'/g, "'\\''")}'`)
    .join('\n');
}

/**
 * Builds ffmpeg arguments that join video-only MP4 segments via the concat demuxer.
 * @param concatListPath - Path to a concat demuxer list file.
 * @param outputPath - Joined video `.mp4` output path.
 * @returns ffmpeg argument vector.
 */
export function buildSmartCutConcatVideoArgs(concatListPath: string, outputPath: string): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatListPath,
    '-c',
    'copy',
    '-y',
    outputPath,
  ];
}

/**
 * Builds ffmpeg arguments that mux a joined video track with a separate audio track.
 * @param videoPath - Joined video-only `.mp4` path.
 * @param audioPath - Full-trim AAC audio path.
 * @param outputPath - Final MP4 output path.
 * @returns ffmpeg argument vector.
 */
export function buildSmartCutMuxVideoAudioArgs(
  videoPath: string,
  audioPath: string,
  outputPath: string
): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-i',
    videoPath,
    '-i',
    audioPath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'copy',
    '-c:a',
    'copy',
    '-avoid_negative_ts',
    'make_zero',
    '-shortest',
    '-movflags',
    '+faststart',
    '-y',
    outputPath,
  ];
}

/**
 * Probes keyframes around both trim boundaries in a local media file.
 * @param mediaPath - Local media file path.
 * @param startSeconds - Trim start in seconds within the file.
 * @param endSeconds - Trim end in seconds within the file.
 * @param durationSeconds - Total media duration in seconds.
 * @returns Merged keyframe timestamps.
 */
export async function probeTrimBoundaryKeyframes(
  mediaPath: string,
  startSeconds: number,
  endSeconds: number,
  durationSeconds: number
): Promise<number[]> {
  const [nearStart, nearEnd] = await Promise.all([
    probeNearbyKeyframes(mediaPath, startSeconds, durationSeconds),
    probeNearbyKeyframes(mediaPath, endSeconds, durationSeconds),
  ]);

  return [...new Set([...nearStart, ...nearEnd])].sort((a, b) => a - b);
}

/**
 * Trims a downloaded section with ffmpeg smart cut: frame-accurate on both trim
 * handles, without re-encoding anything beyond the small head span that has to cross
 * into the next keyframe. See {@link planSmartCut} for why the tail never needs an
 * encode.
 * @param input - Local source file and trim range relative to that file.
 * @param input.isCancelled - Optional callback polled while ffmpeg runs; kills child processes when true.
 * @returns Output path for the trimmed media file.
 */
export async function trimWithSmartCut(input: {
  inputPath: string;
  outputPath: string;
  workDir: string;
  relativeStart: number;
  relativeEnd: number;
  durationSeconds: number;
  isCancelled?: () => Promise<boolean>;
}): Promise<string> {
  await throwIfCancelled(input.isCancelled);

  const sourceParams = await probeSourceMediaParams(input.inputPath);
  const effectiveEnd = resolveEffectiveTrimEnd(
    input.relativeStart,
    input.relativeEnd,
    sourceParams
  );
  const keyframes = await probeTrimBoundaryKeyframes(
    input.inputPath,
    input.relativeStart,
    effectiveEnd,
    input.durationSeconds
  );
  const { frameRateRational, audioSampleRate } = sourceParams;
  const plan = planSmartCut(input.relativeStart, effectiveEnd, keyframes);
  logSmartCutPlan(plan, keyframes, input.relativeStart, effectiveEnd);
  const spawnOptions = { isCancelled: input.isCancelled };

  if (plan.kind === 'copy') {
    await runFfmpeg(
      buildSmartCutCopyOnlyArgs(
        input.inputPath,
        input.outputPath,
        plan.startSeconds,
        plan.endSeconds
      ),
      'ffmpeg smart-cut stream-copy trim',
      spawnOptions
    );
    return input.outputPath;
  }

  if (plan.kind === 'encode') {
    await runFfmpeg(
      buildSmartCutEncodeOnlyArgs(
        input.inputPath,
        input.outputPath,
        plan.startSeconds,
        plan.endSeconds,
        frameRateRational,
        audioSampleRate
      ),
      'ffmpeg smart-cut single-GOP encode',
      spawnOptions
    );
    return input.outputPath;
  }

  const headMp4Path = join(input.workDir, 'smart-cut-head.mp4');
  const copyMp4Path = join(input.workDir, 'smart-cut-copy.mp4');
  const concatListPath = join(input.workDir, 'smart-cut-concat.txt');
  const joinedVideoPath = join(input.workDir, 'smart-cut-video.mp4');
  const audioPath = join(input.workDir, 'smart-cut-audio.m4a');

  try {
    await runFfmpeg(
      buildSmartCutHeadSegmentArgs(
        input.inputPath,
        headMp4Path,
        plan.encodeStart,
        plan.encodeEnd,
        frameRateRational
      ),
      'ffmpeg smart-cut head encode',
      spawnOptions
    );
    await throwIfCancelled(input.isCancelled);

    await runFfmpeg(
      buildSmartCutCopySegmentArgs(
        input.inputPath,
        copyMp4Path,
        plan.encodeStart,
        plan.encodeEnd,
        plan.copyStart,
        plan.copyEnd
      ),
      'ffmpeg smart-cut stream-copy video',
      spawnOptions
    );
    await throwIfCancelled(input.isCancelled);

    await runFfmpeg(
      buildSmartCutAudioTrackArgs(input.inputPath, audioPath, plan.encodeStart, plan.copyEnd),
      'ffmpeg smart-cut audio track',
      spawnOptions
    );
    await throwIfCancelled(input.isCancelled);

    await writeFile(
      concatListPath,
      `${buildSmartCutConcatListContent([headMp4Path, copyMp4Path])}\n`,
      'utf8'
    );
    await runFfmpeg(
      buildSmartCutConcatVideoArgs(concatListPath, joinedVideoPath),
      'ffmpeg smart-cut concat video',
      spawnOptions
    );
    await throwIfCancelled(input.isCancelled);

    await runFfmpeg(
      buildSmartCutMuxVideoAudioArgs(joinedVideoPath, audioPath, input.outputPath),
      'ffmpeg smart-cut mux video and audio',
      spawnOptions
    );
  } finally {
    await Promise.all([
      rm(headMp4Path, { force: true }).catch(() => {}),
      rm(copyMp4Path, { force: true }).catch(() => {}),
      rm(concatListPath, { force: true }).catch(() => {}),
      rm(joinedVideoPath, { force: true }).catch(() => {}),
      rm(audioPath, { force: true }).catch(() => {}),
    ]);
  }

  return input.outputPath;
}
