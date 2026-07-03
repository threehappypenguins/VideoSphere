import { join } from 'node:path';
import { probeNearbyKeyframes } from '@/lib/youtube-import/probe-keyframes';
import {
  runSpawnWithCancel,
  YoutubeImportJobCancelledError,
} from '@/lib/youtube-import/spawn-with-cancel';
import { spawnProcess } from '@/lib/youtube-import/spawn-process';

/** Treat timestamps within this distance as sitting on a keyframe. */
const KEYFRAME_EPSILON_SECONDS = 0.05;

/** Fallback fps when ffprobe cannot read the source stream rate. */
const SMART_CUT_DEFAULT_FRAME_RATE = 30;

/** Fallback audio sample rate when ffprobe cannot read the source stream rate. */
const SMART_CUT_DEFAULT_AUDIO_SAMPLE_RATE = 44_100;

/** Common broadcast frame rates used to normalize ffprobe output. */
const STANDARD_FRAME_RATES = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60] as const;

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
 * Prefer the source `r_frame_rate` so re-encoded edges match stream-copy timing.
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
 * Builds libx264 arguments for smart-cut re-encode segments.
 * @param frameRate - Target constant output frame rate.
 * @returns ffmpeg video-encoding argument list.
 */
export function buildSmartCutVideoEncodeArgs(frameRate: number): string[] {
  return [
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-r',
    String(frameRate),
    '-fps_mode',
    'cfr',
  ];
}

/**
 * Builds libx264 codec arguments for filter-graph smart-cut encodes.
 * @param frameRateRational - Target output frame rate as an ffprobe-style rational.
 * @returns ffmpeg video-encoding argument list.
 */
export function buildSmartCutFilteredVideoEncodeArgs(frameRateRational: string): string[] {
  return [
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-r',
    frameRateRational,
    '-fps_mode',
    'cfr',
    '-force_key_frames',
    '0',
    '-x264-params',
    'bframes=0:open_gop=0',
  ];
}

/**
 * Formats a frame rate for ffmpeg's `fps` filter.
 * @param frameRate - Target output frame rate.
 * @returns Rational or decimal fps expression accepted by ffmpeg.
 */
export function formatFpsFilterValue(frameRate: number): string {
  if (Math.abs(frameRate - 29.97) < 0.01) {
    return '30000/1001';
  }
  if (Math.abs(frameRate - 23.976) < 0.01) {
    return '24000/1001';
  }
  if (Math.abs(frameRate - 59.94) < 0.01) {
    return '60000/1001';
  }

  return String(frameRate);
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
 * Builds a frame-accurate encode filter graph for one smart-cut segment.
 * Frame rate is enforced at encode time so packet timing stays aligned with stream-copy segments.
 * @param startSeconds - Trim start in seconds within the source file.
 * @param endSeconds - Trim end in seconds within the source file.
 * @returns ffmpeg `-filter_complex` graph string.
 */
export function buildSmartCutEncodeFilterGraph(startSeconds: number, endSeconds: number): string {
  const start = formatFilterSeconds(startSeconds);
  const end = formatFilterSeconds(endSeconds);

  return `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v];[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,aresample=async=1:first_pts=0[a]`;
}

/**
 * One contiguous trim segment produced by {@link planSmartCutSegments}.
 */
export type SmartCutSegment =
  | { mode: 'copy'; startSeconds: number; endSeconds: number }
  | { mode: 'encode'; startSeconds: number; endSeconds: number };

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
 * @returns Previous keyframe timestamp, or null when none exist.
 */
export function findPrevKeyframeAtOrBefore(timestamp: number, keyframes: number[]): number | null {
  const sorted = [...new Set(keyframes.filter(Number.isFinite))].sort((a, b) => a - b);
  let previous: number | null = null;
  for (const keyframe of sorted) {
    if (keyframe <= timestamp + KEYFRAME_EPSILON_SECONDS) {
      previous = keyframe;
    } else {
      break;
    }
  }
  return previous;
}

/**
 * Builds copy/encode segments for a frame-accurate trim without re-encoding the full clip.
 * @param startSeconds - Desired trim start in seconds within the source file.
 * @param endSeconds - Desired trim end in seconds within the source file.
 * @param keyframes - Known keyframe timestamps in seconds within the source file.
 * @returns Ordered smart-cut segments.
 */
export function planSmartCutSegments(
  startSeconds: number,
  endSeconds: number,
  keyframes: number[]
): SmartCutSegment[] {
  if (endSeconds <= startSeconds) {
    throw new Error('endSeconds must be greater than startSeconds');
  }

  const knownKeyframes = [...new Set(keyframes.filter(Number.isFinite))].sort((a, b) => a - b);
  const segments: SmartCutSegment[] = [];
  let cursor = startSeconds;

  if (!isOnKeyframe(startSeconds, knownKeyframes)) {
    const nextKeyframe = findNextKeyframeAfter(startSeconds, knownKeyframes);
    if (nextKeyframe == null || nextKeyframe >= endSeconds) {
      return [{ mode: 'encode', startSeconds, endSeconds }];
    }
    segments.push({ mode: 'encode', startSeconds, endSeconds: nextKeyframe });
    cursor = nextKeyframe;
  }

  if (isOnKeyframe(endSeconds, knownKeyframes)) {
    if (endSeconds > cursor + KEYFRAME_EPSILON_SECONDS) {
      segments.push({ mode: 'copy', startSeconds: cursor, endSeconds });
    }
    return segments.length > 0 ? segments : [{ mode: 'copy', startSeconds, endSeconds }];
  }

  const previousKeyframe = findPrevKeyframeAtOrBefore(endSeconds, knownKeyframes);
  if (previousKeyframe == null) {
    if (endSeconds > cursor + KEYFRAME_EPSILON_SECONDS) {
      segments.push({ mode: 'encode', startSeconds: cursor, endSeconds });
    }
    return segments.length > 0 ? segments : [{ mode: 'encode', startSeconds, endSeconds }];
  }

  if (previousKeyframe > cursor + KEYFRAME_EPSILON_SECONDS) {
    segments.push({ mode: 'copy', startSeconds: cursor, endSeconds: previousKeyframe });
  }

  if (endSeconds > previousKeyframe + KEYFRAME_EPSILON_SECONDS) {
    segments.push({ mode: 'encode', startSeconds: previousKeyframe, endSeconds });
  }

  return segments.length > 0 ? segments : [{ mode: 'encode', startSeconds, endSeconds }];
}

/**
 * Returns true when smart cut should use one filter encode for the full trim range.
 * Mixed encode/copy segment joins have proven unreliable on YouTube progressive downloads,
 * so callers should avoid extracting and concatenating multiple segments.
 * @param segments - Planned smart-cut segments.
 * @returns Whether to run a single-pass full encode instead of segment joins.
 */
export function shouldUseFullFilterEncode(segments: readonly SmartCutSegment[]): boolean {
  return segments.length > 1;
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
 * Resolves ffmpeg trim bounds for one smart-cut segment.
 * Segment ends are shared keyframe boundaries: encode `trim`/`atrim` treat end as
 * exclusive, while copy `-to` stops at the same timestamp, so joins stay contiguous.
 * @param segment - Planned smart-cut segment.
 * @returns Absolute start/end timestamps within the source file.
 */
export function resolveSmartCutSegmentTrimBounds(segment: SmartCutSegment): {
  startSeconds: number;
  endSeconds: number;
} {
  return {
    startSeconds: segment.startSeconds,
    endSeconds: segment.endSeconds,
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
  frameRate: number;
  frameRateRational: string;
  audioSampleRate: number;
};

/**
 * Reads frame rate and audio sample rate from the first video/audio streams.
 * @param mediaPath - Local media file path.
 * @returns Parsed media parameters with smart-cut defaults as fallback.
 */
async function probeSourceMediaParams(mediaPath: string): Promise<SmartCutSourceMediaParams> {
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawnProcess(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type,r_frame_rate,avg_frame_rate,sample_rate',
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
    frameRate: resolveSmartCutFrameRate(videoStream?.r_frame_rate, videoStream?.avg_frame_rate),
    frameRateRational: resolveSmartCutFrameRateRational(
      videoStream?.r_frame_rate,
      videoStream?.avg_frame_rate
    ),
    audioSampleRate:
      parseAudioSampleRate(audioStream?.sample_rate ?? '') ?? SMART_CUT_DEFAULT_AUDIO_SAMPLE_RATE,
  };
}

/**
 * Builds ffmpeg arguments for a single-pass filter encode over the full trim range.
 * @param inputPath - Source media path.
 * @param outputPath - Output media path.
 * @param startSeconds - Trim start in seconds within the source file.
 * @param endSeconds - Trim end in seconds within the source file.
 * @param frameRateRational - Target fps as an ffprobe-style rational.
 * @param audioSampleRate - Target audio sample rate in Hz.
 * @returns ffmpeg argument vector.
 */
export function buildSmartCutFullEncodeFfmpegArgs(
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
    '-i',
    inputPath,
    '-filter_complex',
    buildSmartCutEncodeFilterGraph(startSeconds, endSeconds),
    '-map',
    '[v]',
    '-map',
    '[a]',
    ...buildSmartCutFilteredVideoEncodeArgs(frameRateRational),
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
 * Builds ffmpeg arguments for one smart-cut segment.
 * Used only when the trim resolves to a single stream-copy or single encode segment.
 * @param inputPath - Source media path.
 * @param outputPath - Segment output path.
 * @param segment - Planned smart-cut segment.
 * @param frameRateRational - Target fps for encode segments as an ffprobe-style rational.
 * @param audioSampleRate - Target audio sample rate for encode segments.
 * @returns ffmpeg argument vector.
 */
export function buildSmartCutSegmentFfmpegArgs(
  inputPath: string,
  outputPath: string,
  segment: SmartCutSegment,
  frameRateRational: string,
  audioSampleRate: number
): string[] {
  const trimBounds = resolveSmartCutSegmentTrimBounds(segment);

  if (segment.mode === 'copy') {
    return [
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'error',
      '-ss',
      String(trimBounds.startSeconds),
      '-i',
      inputPath,
      '-to',
      String(trimBounds.endSeconds),
      '-map',
      '0',
      '-reset_timestamps',
      '1',
      '-avoid_negative_ts',
      'make_zero',
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      '-y',
      outputPath,
    ];
  }

  return buildSmartCutFullEncodeFfmpegArgs(
    inputPath,
    outputPath,
    trimBounds.startSeconds,
    trimBounds.endSeconds,
    frameRateRational,
    audioSampleRate
  );
}

/**
 * Trims a downloaded section with ffmpeg smart cut.
 * When both trim boundaries sit on keyframes, the clip is stream-copied in one pass.
 * Otherwise a single filter encode trims the full requested range in one ffmpeg process,
 * avoiding mixed encode/copy segment joins that are unreliable on YouTube downloads.
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

  const keyframes = await probeTrimBoundaryKeyframes(
    input.inputPath,
    input.relativeStart,
    input.relativeEnd,
    input.durationSeconds
  );
  const { frameRateRational, audioSampleRate } = await probeSourceMediaParams(input.inputPath);
  const segments = planSmartCutSegments(input.relativeStart, input.relativeEnd, keyframes);
  const spawnOptions = { isCancelled: input.isCancelled };

  if (shouldUseFullFilterEncode(segments)) {
    await runFfmpeg(
      buildSmartCutFullEncodeFfmpegArgs(
        input.inputPath,
        input.outputPath,
        input.relativeStart,
        input.relativeEnd,
        frameRateRational,
        audioSampleRate
      ),
      'ffmpeg smart-cut full filter encode',
      spawnOptions
    );
    return input.outputPath;
  }

  const segment = segments[0];
  if (!segment) {
    throw new Error('Smart cut produced no trim segments');
  }

  await runFfmpeg(
    buildSmartCutSegmentFfmpegArgs(
      input.inputPath,
      input.outputPath,
      segment,
      frameRateRational,
      audioSampleRate
    ),
    segment.mode === 'copy'
      ? 'ffmpeg smart-cut stream-copy trim'
      : 'ffmpeg smart-cut filter encode',
    spawnOptions
  );

  return input.outputPath;
}
