import { spawnProcess } from '@/lib/youtube-import/spawn-process';
import { buildYouTubeWatchUrl } from '@/lib/youtube-import/resolve-source';
import { buildYtDlpMetadataArgs } from '@/lib/youtube-import/yt-dlp-args';
import { buildYtDlpProcessError } from '@/lib/youtube-import/yt-dlp-errors';

const YOUTUBE_VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
/** Default spawn timeout for yt-dlp/ffprobe metadata probes (slow on ARM / cold cache). */
const DEFAULT_PROCESS_TIMEOUT_MS = 60_000;
const MAX_PROCESS_TIMEOUT_MS = 300_000;

let processTimeoutMsForTests: number | null = null;

/**
 * Overrides the spawn timeout in unit tests.
 * @param timeoutMs - Timeout in milliseconds, or `null` to restore the default.
 * @internal
 */
export function setYouTubeImportProcessTimeoutMsForTests(timeoutMs: number | null): void {
  processTimeoutMsForTests = timeoutMs;
}

function getProcessTimeoutMs(): number {
  if (processTimeoutMsForTests !== null) {
    return processTimeoutMsForTests;
  }

  const fromEnv = process.env.YOUTUBE_IMPORT_PROCESS_TIMEOUT_MS?.trim();
  if (fromEnv) {
    const parsed = Number(fromEnv);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(parsed, MAX_PROCESS_TIMEOUT_MS);
    }
  }

  return DEFAULT_PROCESS_TIMEOUT_MS;
}

/** Default expiry when yt-dlp does not expose a format expiration timestamp. */
const DEFAULT_DIRECT_MEDIA_URL_TTL_MS = 60 * 60 * 1000;

/** Maximum preview height — keeps browser range seeks on small progressive MP4s. */
const PREVIEW_MAX_HEIGHT_PX = 360;

type YtDlpFormat = {
  url?: string;
  height?: number;
  width?: number;
  vcodec?: string;
  acodec?: string;
  expires?: number;
  ext?: string;
  protocol?: string;
  format_id?: string;
};

type YtDlpJsonMetadata = {
  formats?: YtDlpFormat[];
  duration?: number;
};

/**
 * Short-lived direct media URL suitable for ffprobe reads.
 */
export interface YouTubeDirectMediaUrl {
  /** Progressive or video-only media URL from yt-dlp. */
  url: string;
  /** Approximate Unix expiry time in milliseconds. */
  expiresAt: number;
  /** Total media duration in seconds from yt-dlp metadata. */
  durationSeconds: number;
}

function assertValidYouTubeVideoId(youtubeVideoId: string): void {
  if (!YOUTUBE_VIDEO_ID_PATTERN.test(youtubeVideoId)) {
    throw new Error('Invalid YouTube video id');
  }
}

function processExitError(label: string, code: number | null, stderrChunks: Buffer[]): Error {
  return buildYtDlpProcessError(label, code, stderrChunks);
}

/**
 * Runs a child process with stdout/stderr collection and a hard timeout.
 * @param command - Executable name on `PATH`.
 * @param args - Argument vector.
 * @param label - Human-readable label for error messages.
 * @returns Captured stdout and stderr on success.
 */
async function runProcess(
  command: string,
  args: string[],
  label: string
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    let timedOut = false;
    const timeoutMs = getProcessTimeoutMs();
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    const finish = (callback: () => void) => {
      clearTimeout(timeout);
      callback();
    };

    child.on('close', (code) => {
      if (timedOut) {
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
        if (stderr) {
          console.error(
            `[${label}] timed out after ${timeoutMs}ms; stderr tail:`,
            stderr.slice(-2000)
          );
        }
        finish(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)));
        return;
      }
      if (code !== 0) {
        finish(() => reject(processExitError(label, code, stderrChunks)));
        return;
      }
      finish(() =>
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
        })
      );
    });

    child.on('error', (err) => {
      finish(() => reject(err));
    });
  });
}

/**
 * Returns true when a yt-dlp format is a direct HTTPS MP4 stream suitable for HTML5 range playback.
 * @param format - Candidate format row from yt-dlp JSON metadata.
 * @returns Whether the format can be proxied for in-browser preview.
 */
export function isBrowserStreamableMp4Format(format: YtDlpFormat): boolean {
  const url = format.url?.trim();
  if (!url) {
    return false;
  }
  if ((format.vcodec ?? 'none') === 'none') {
    return false;
  }

  const protocol = (format.protocol ?? 'https').toLowerCase();
  if (protocol.includes('m3u8') || protocol.includes('dash')) {
    return false;
  }

  const ext = (format.ext ?? '').toLowerCase();
  if (ext && ext !== 'mp4' && ext !== '3gp') {
    return false;
  }

  return true;
}

function comparePreviewFormats(a: YtDlpFormat, b: YtDlpFormat): number {
  const heightA = a.height ?? Number.MAX_SAFE_INTEGER;
  const heightB = b.height ?? Number.MAX_SAFE_INTEGER;
  if (heightA !== heightB) {
    return heightA - heightB;
  }

  const widthA = a.width ?? Number.MAX_SAFE_INTEGER;
  const widthB = b.width ?? Number.MAX_SAFE_INTEGER;
  if (widthA !== widthB) {
    return widthA - widthB;
  }

  const aProgressive = (a.acodec ?? 'none') !== 'none' ? 0 : 1;
  const bProgressive = (b.acodec ?? 'none') !== 'none' ? 0 : 1;
  return aProgressive - bProgressive;
}

/**
 * Picks the lowest-resolution candidate from a format list.
 * @param candidates - Usable yt-dlp format rows.
 * @returns Lowest preview candidate, or null when the list is empty.
 */
function pickLowestPreviewFormat(candidates: YtDlpFormat[]): YtDlpFormat | null {
  if (candidates.length === 0) {
    return null;
  }

  const sorted = [...candidates].sort(comparePreviewFormats);
  return sorted[0] ?? null;
}

function isProgressiveFormat(format: YtDlpFormat): boolean {
  return (format.acodec ?? 'none') !== 'none';
}

function isWithinPreviewHeightCap(format: YtDlpFormat): boolean {
  return (
    typeof format.height === 'number' && format.height > 0 && format.height <= PREVIEW_MAX_HEIGHT_PX
  );
}

/**
 * Picks a low-resolution MP4 format for in-browser preview and ffprobe probing.
 * @param formats - Format rows from yt-dlp JSON metadata.
 * @returns Best probe candidate, or null when none is usable.
 */
export function pickYtDlpProbeFormat(formats: YtDlpFormat[]): YtDlpFormat | null {
  const usable = formats.filter(isBrowserStreamableMp4Format);
  if (usable.length === 0) {
    return null;
  }

  const progressive = usable.filter(isProgressiveFormat);
  const progressiveWithinCap = progressive.filter(isWithinPreviewHeightCap);
  const progressivePick = pickLowestPreviewFormat(progressiveWithinCap);
  if (progressivePick) {
    return progressivePick;
  }

  const progressiveFallback = pickLowestPreviewFormat(progressive);
  if (progressiveFallback) {
    return progressiveFallback;
  }

  const withinHeightCap = usable.filter(isWithinPreviewHeightCap);
  const candidates = withinHeightCap.length > 0 ? withinHeightCap : usable;
  return pickLowestPreviewFormat(candidates);
}

function resolveFormatExpiresAt(format: YtDlpFormat, url: string): number {
  if (typeof format.expires === 'number' && Number.isFinite(format.expires) && format.expires > 0) {
    return format.expires > 1e12 ? format.expires : format.expires * 1000;
  }

  try {
    const expireParam = new URL(url).searchParams.get('expire');
    if (expireParam) {
      const seconds = Number(expireParam);
      if (Number.isFinite(seconds) && seconds > 0) {
        return seconds * 1000;
      }
    }
  } catch {
    // Ignore malformed URLs.
  }

  return Date.now() + DEFAULT_DIRECT_MEDIA_URL_TTL_MS;
}

/**
 * Resolves a short-lived direct media URL for a YouTube video via yt-dlp metadata.
 * @param youtubeVideoId - Valid 11-character YouTube video id.
 * @returns Direct media URL and approximate expiry timestamp.
 */
export async function getDirectMediaUrl(youtubeVideoId: string): Promise<YouTubeDirectMediaUrl> {
  assertValidYouTubeVideoId(youtubeVideoId);

  const watchUrl = buildYouTubeWatchUrl(youtubeVideoId);
  const { stdout } = await runProcess(
    'yt-dlp',
    buildYtDlpMetadataArgs(watchUrl),
    'yt-dlp metadata lookup'
  );

  let metadata: YtDlpJsonMetadata;
  try {
    metadata = JSON.parse(stdout) as YtDlpJsonMetadata;
  } catch {
    throw new Error('yt-dlp metadata lookup returned invalid JSON');
  }

  const selected = pickYtDlpProbeFormat(metadata.formats ?? []);
  const url = selected?.url?.trim();
  if (!url) {
    throw new Error(
      'yt-dlp did not return a playable video format (YouTube JS challenge solving may have failed on the server)'
    );
  }

  const durationSeconds = metadata.duration;
  if (
    typeof durationSeconds !== 'number' ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    throw new Error('yt-dlp metadata lookup did not return video duration');
  }

  return {
    url,
    expiresAt: resolveFormatExpiresAt(selected, url),
    durationSeconds,
  };
}

/**
 * Parses ffprobe CSV frame output for keyframe timestamps.
 * Column order follows `-show_entries frame=key_frame,pts_time`.
 * @param stdout - Raw ffprobe stdout.
 * @param ptsOffsetSeconds - Seconds to add to each parsed timestamp (read-interval relative times).
 * @returns Keyframe timestamps in seconds, sorted ascending.
 */
export function parseFfprobeKeyframeCsv(stdout: string, ptsOffsetSeconds = 0): number[] {
  const keyframes: number[] = [];

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const [keyFrameRaw, ptsTimeRaw] = trimmed.split(',');
    if (keyFrameRaw?.trim() !== '1') {
      continue;
    }

    const seconds = Number(ptsTimeRaw);
    if (Number.isFinite(seconds)) {
      keyframes.push(seconds + ptsOffsetSeconds);
    }
  }

  return keyframes.sort((a, b) => a - b);
}

/**
 * Builds an ffprobe `-read_intervals` value centered on a timestamp.
 * ffprobe expects a file-percentage start plus a duration window, not absolute seconds.
 * @param nearSeconds - Approximate timestamp to search around.
 * @param windowSeconds - Total read window size in seconds.
 * @param durationSeconds - Total media duration in seconds.
 * @returns ffprobe read interval specification and the interval start in seconds.
 */
export function buildFfprobeReadInterval(
  nearSeconds: number,
  windowSeconds: number,
  durationSeconds: number
): { readInterval: string; intervalStartSeconds: number } {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('durationSeconds must be a positive number');
  }

  const intervalStartSeconds = Math.max(0, nearSeconds - windowSeconds / 2);
  const percent = (intervalStartSeconds / durationSeconds) * 100;
  return {
    readInterval: `${percent}%+${windowSeconds}`,
    intervalStartSeconds,
  };
}

/**
 * Probes nearby video keyframes using a narrow ffprobe read window.
 * @param mediaUrl - Direct media URL readable by ffprobe.
 * @param nearSeconds - Approximate timestamp to search around.
 * @param durationSeconds - Total media duration in seconds.
 * @param windowSeconds - Total read window size in seconds.
 * @returns Keyframe timestamps found in the window, or an empty array when probing fails.
 */
export async function probeNearbyKeyframes(
  mediaUrl: string,
  nearSeconds: number,
  durationSeconds: number,
  windowSeconds = 8
): Promise<number[]> {
  if (!mediaUrl.trim()) {
    throw new Error('Media URL is required');
  }
  if (!Number.isFinite(nearSeconds) || nearSeconds < 0) {
    throw new Error('nearSeconds must be a non-negative number');
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('durationSeconds must be a positive number');
  }
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    throw new Error('windowSeconds must be a positive number');
  }

  const { readInterval, intervalStartSeconds } = buildFfprobeReadInterval(
    nearSeconds,
    windowSeconds,
    durationSeconds
  );

  try {
    const { stdout } = await runProcess(
      'ffprobe',
      [
        '-read_intervals',
        readInterval,
        '-select_streams',
        'v:0',
        '-show_entries',
        'frame=key_frame,pts_time',
        '-of',
        'csv=p=0',
        mediaUrl,
      ],
      'ffprobe keyframe probe'
    );

    return parseFfprobeKeyframeCsv(stdout, intervalStartSeconds);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[probeNearbyKeyframes] ffprobe failed:', message);
    return [];
  }
}
