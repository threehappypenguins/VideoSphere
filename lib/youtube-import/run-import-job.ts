import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat } from '@/lib/youtube-import/import-job-fs';
import { join } from 'node:path';
import { uploadLocalFileToR2 } from '@/lib/r2';
import { createUploadJob, updateUploadJobStatus } from '@/lib/repositories/upload-jobs';
import {
  getYoutubeImportJobById,
  updateYoutubeImportJobStatus,
} from '@/lib/repositories/youtube-import-jobs';
import { buildYouTubeWatchUrl } from '@/lib/youtube-import/resolve-source';
import { distributeStagedYoutubeImportUpload } from '@/lib/youtube-import/queue-import-distribute';
import { trimWithSmartCut } from '@/lib/youtube-import/smart-cut';
import {
  runSpawnWithCancel,
  YoutubeImportJobCancelledError,
} from '@/lib/youtube-import/spawn-with-cancel';
import {
  buildYtDlpBaseArgs,
  YT_DLP_IMPORT_CONCURRENT_FRAGMENTS,
  YT_DLP_IMPORT_DOWNLOAD_FORMAT,
  YT_DLP_IMPORT_HTTP_CHUNK_SIZE,
} from '@/lib/youtube-import/yt-dlp-args';
import type { YoutubeImportJob } from '@/types';

const DEFAULT_YT_IMPORT_WORKDIR = '/tmp/yt-import';
const DOWNLOADED_BASENAME = 'download';
const TRIMMED_BASENAME = 'trimmed.mp4';
const DOWNLOAD_PROGRESS_MAX = 70;
const TRIM_PROGRESS = 85;
const UPLOAD_PROGRESS = 95;

/**
 * Parses a yt-dlp `[download] …%` progress chunk.
 * @param chunk - stdout/stderr fragment from yt-dlp.
 * @returns Download percent when present, otherwise `null`.
 */
export function parseYtDlpDownloadPercent(chunk: string): number | null {
  const match = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(chunk);
  if (!match) {
    return null;
  }

  const percent = Number(match[1]);
  return Number.isFinite(percent) ? percent : null;
}

/**
 * Converts a yt-dlp human-readable size label to bytes.
 * @param value - Numeric size amount from yt-dlp output.
 * @param unit - Size unit suffix such as `MiB` or `GiB`.
 * @returns Size in bytes, or `null` when the unit is unsupported.
 */
export function parseYtDlpDownloadSizeToBytes(value: string, unit: string): number | null {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  const multipliers: Record<string, number> = {
    b: 1,
    kib: 1024,
    mib: 1024 ** 2,
    gib: 1024 ** 3,
    tib: 1024 ** 4,
    kb: 1000,
    mb: 1000 ** 2,
    gb: 1000 ** 3,
  };

  const multiplier = multipliers[unit.toLowerCase()];
  return multiplier == null ? null : amount * multiplier;
}

/**
 * Parsed yt-dlp `[download]` progress for one stream.
 * @property percent - Stream-local completion percent.
 * @property totalBytes - Declared stream size when yt-dlp reports it.
 */
export interface YtDlpDownloadProgressLine {
  /** Stream-local completion percent. */
  percent: number;
  /** Declared stream size when yt-dlp reports it. */
  totalBytes: number | null;
}

/**
 * Parses percent and optional total-size hints from a yt-dlp `[download]` line.
 * @param chunk - stdout/stderr fragment from yt-dlp.
 * @returns Parsed stream progress, or `null` when no `[download]` percent is present.
 */
export function parseYtDlpDownloadProgressLine(chunk: string): YtDlpDownloadProgressLine | null {
  const percent = parseYtDlpDownloadPercent(chunk);
  if (percent == null) {
    return null;
  }

  const sizeMatch =
    /\[download\][^\n]*%\s+of\s+~?\s*([\d.]+)\s*(KiB|MiB|GiB|TiB|KB|MB|GB|B)\b/i.exec(chunk);

  return {
    percent,
    totalBytes: sizeMatch ? parseYtDlpDownloadSizeToBytes(sizeMatch[1], sizeMatch[2]) : null,
  };
}

interface TrackedDownloadStream {
  totalBytes: number | null;
  completed: boolean;
  lastPercent: number;
}

/**
 * Aggregates per-stream yt-dlp `[download]` progress into one continuous 0–100% value.
 * `bv*+ba` downloads video and audio separately; this weights each stream by size when
 * available and falls back to equal per-stream weighting otherwise.
 */
export class YtDlpMultiStreamDownloadProgressTracker {
  private streams: TrackedDownloadStream[] = [];
  private currentStreamIndex = -1;

  /**
   * Incorporates one yt-dlp stdout/stderr chunk.
   * @param chunk - stdout/stderr fragment from yt-dlp.
   * @returns Combined download percent across all streams, or `null` when no progress line is present.
   */
  update(chunk: string): number | null {
    const parsed = parseYtDlpDownloadProgressLine(chunk);
    if (!parsed) {
      return null;
    }

    this.ensureCurrentStream(parsed.percent, parsed.totalBytes);

    const stream = this.streams[this.currentStreamIndex];
    if (parsed.totalBytes != null) {
      stream.totalBytes = parsed.totalBytes;
    }
    stream.lastPercent = parsed.percent;
    if (parsed.percent >= 100) {
      stream.completed = true;
    }

    return this.computeOverallPercent();
  }

  private ensureCurrentStream(percent: number, totalBytes: number | null): void {
    const current =
      this.currentStreamIndex >= 0 ? this.streams[this.currentStreamIndex] : undefined;

    if (current == null) {
      this.startNewStream(percent, totalBytes);
      return;
    }

    if (current.completed) {
      this.startNewStream(percent, totalBytes);
      return;
    }

    const percentReset = current.lastPercent > 30 && percent < current.lastPercent - 10;
    const sizeChanged =
      totalBytes != null &&
      current.totalBytes != null &&
      Math.abs(totalBytes - current.totalBytes) / current.totalBytes > 0.05;

    if (percentReset || sizeChanged) {
      this.completeCurrentStream();
      this.startNewStream(percent, totalBytes);
    }
  }

  private startNewStream(percent: number, totalBytes: number | null): void {
    this.streams.push({
      totalBytes,
      completed: false,
      lastPercent: percent,
    });
    this.currentStreamIndex = this.streams.length - 1;
  }

  private completeCurrentStream(): void {
    const current = this.streams[this.currentStreamIndex];
    if (!current) {
      return;
    }

    current.completed = true;
    current.lastPercent = 100;
  }

  private computeOverallPercent(): number {
    const allSizesKnown = this.streams.every(
      (stream) => stream.totalBytes != null && stream.totalBytes > 0
    );

    if (allSizesKnown) {
      let downloadedBytes = 0;
      let totalBytes = 0;

      for (const [index, stream] of this.streams.entries()) {
        const streamTotal = stream.totalBytes ?? 0;
        totalBytes += streamTotal;

        if (stream.completed) {
          downloadedBytes += streamTotal;
        } else if (index === this.currentStreamIndex) {
          downloadedBytes += (stream.lastPercent / 100) * streamTotal;
        }
      }

      return totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;
    }

    const streamWeight = 100 / this.streams.length;
    let combinedPercent = 0;

    for (const [index, stream] of this.streams.entries()) {
      if (stream.completed) {
        combinedPercent += streamWeight;
      } else if (index === this.currentStreamIndex) {
        combinedPercent += (stream.lastPercent / 100) * streamWeight;
      }
    }

    return combinedPercent;
  }
}

/**
 * Parses the latest non-negative `time=HH:MM:SS.ms` value from ffmpeg stderr.
 * Used as a fallback when yt-dlp delegates muxing to ffmpeg without `[download] …%` lines.
 * @param chunk - stdout/stderr fragment from yt-dlp/ffmpeg.
 * @returns Elapsed output seconds when present, otherwise `null`.
 */
export function parseFfmpegTimeSeconds(chunk: string): number | null {
  let latest: number | null = null;

  for (const match of chunk.matchAll(/time=(-)?(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/g)) {
    if (match[1] === '-') {
      continue;
    }

    const hours = Number(match[2]);
    const minutes = Number(match[3]);
    const seconds = Number(match[4]);
    const total = hours * 3600 + minutes * 60 + seconds;
    if (Number.isFinite(total) && total >= 0) {
      latest = total;
    }
  }

  return latest;
}

/**
 * Maps yt-dlp/ffmpeg progress signals to the download phase percent (0–70).
 * @param input - Parsed progress signals and optional source duration for ffmpeg fallback.
 * @returns Overall job percent for the download phase, or `null` when no signal is present.
 */
export function computeDownloadPhaseProgressPercent(input: {
  downloadPercent: number | null;
  ffmpegTimeSeconds: number | null;
  sourceDurationSeconds?: number;
  maxPercent?: number;
}): number | null {
  const maxPercent = input.maxPercent ?? DOWNLOAD_PROGRESS_MAX;
  let ratio: number | null = null;

  if (input.downloadPercent != null) {
    ratio = Math.min(1, Math.max(0, input.downloadPercent / 100));
  } else if (
    input.ffmpegTimeSeconds != null &&
    input.sourceDurationSeconds != null &&
    input.sourceDurationSeconds > 0 &&
    input.ffmpegTimeSeconds >= 0
  ) {
    ratio = Math.min(1, input.ffmpegTimeSeconds / input.sourceDurationSeconds);
  }

  if (ratio == null) {
    return null;
  }

  return Math.min(maxPercent, Math.max(1, Math.floor(ratio * maxPercent)));
}

/**
 * Computes ffmpeg trim offsets inside a full source download.
 * @param input - Requested trim points and the downloaded file duration.
 * @returns Absolute `-ss`/`-t` values for the downloaded file.
 */
export function computeTrimOffsets(input: {
  jobStartSeconds: number;
  jobEndSeconds: number;
  downloadedDurationSeconds: number;
}): { relativeStart: number; relativeEnd: number } {
  const relativeStart = Math.max(0, input.jobStartSeconds);
  const relativeEnd = Math.min(input.downloadedDurationSeconds, input.jobEndSeconds);

  if (
    !Number.isFinite(relativeStart) ||
    !Number.isFinite(relativeEnd) ||
    relativeEnd <= relativeStart
  ) {
    throw new Error('Trim range is empty after source download');
  }

  return { relativeStart, relativeEnd };
}

/**
 * Builds an R2 staging key for a YouTube import upload, mirroring presign naming.
 * @param userId - Owning user id.
 * @param youtubeVideoId - Source YouTube video id.
 * @returns Object key under `temp/uploads/{userId}/...`.
 */
export function buildYoutubeImportUploadKey(userId: string, youtubeVideoId: string): string {
  const sanitized = `youtube-import-${youtubeVideoId}.mp4`.replace(/[/\\]/g, '_');
  const timestamp = Date.now();
  const uid = randomUUID();
  return `temp/uploads/${userId}/${timestamp}-${uid}/${sanitized}`;
}

function getYoutubeImportWorkdirRoot(): string {
  const configured = process.env.YT_IMPORT_WORKDIR?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_YT_IMPORT_WORKDIR;
}

async function createImportWorkDir(): Promise<string> {
  const root = getYoutubeImportWorkdirRoot();
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root.endsWith('/') ? root : `${root}/`, 'yt-import-job-'));
}

async function runSpawnCollecting(
  command: string,
  args: readonly string[],
  label: string,
  options?: {
    onStderrChunk?: (chunk: string) => void;
    onStdoutChunk?: (chunk: string) => void;
    isCancelled?: () => Promise<boolean>;
  }
): Promise<void> {
  return runSpawnWithCancel(command, args, label, options);
}

async function runSpawnStdout(
  command: string,
  args: readonly string[],
  label: string,
  options?: { isCancelled?: () => Promise<boolean> }
): Promise<string> {
  let stdout = '';
  await runSpawnCollecting(command, args, label, {
    ...options,
    onStdoutChunk: (chunk) => {
      stdout += chunk;
    },
  });
  return stdout.trim();
}

async function readDownloadMetadata(
  workDir: string,
  jobId: string
): Promise<{
  downloadedPath: string;
  downloadedDurationSeconds: number;
}> {
  const downloadedPath = join(workDir, `${DOWNLOADED_BASENAME}.mp4`);
  const isCancelled = () => isImportJobCancelled(jobId);

  const durationRaw = await runSpawnStdout(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      downloadedPath,
    ],
    'ffprobe duration probe',
    { isCancelled }
  );

  const downloadedDurationSeconds = Number(durationRaw);
  if (!Number.isFinite(downloadedDurationSeconds) || downloadedDurationSeconds <= 0) {
    throw new Error('Downloaded source has invalid duration');
  }

  return { downloadedPath, downloadedDurationSeconds };
}

async function isImportJobCancelled(jobId: string): Promise<boolean> {
  const current = await getYoutubeImportJobById(jobId);
  return current?.status === 'cancelled';
}

async function downloadYoutubeSource(
  job: YoutubeImportJob,
  workDir: string,
  jobId: string
): Promise<{
  downloadedPath: string;
  downloadedDurationSeconds: number;
}> {
  const watchUrl = buildYouTubeWatchUrl(job.youtubeVideoId);
  const outputTemplate = join(workDir, `${DOWNLOADED_BASENAME}.%(ext)s`);

  let lastPersistedPercent = -1;
  const progressTracker = new YtDlpMultiStreamDownloadProgressTracker();

  void updateYoutubeImportJobStatus(jobId, { progressPercent: 1 });

  const handleDownloadProgressChunk = (chunk: string) => {
    const overallPercent = computeDownloadPhaseProgressPercent({
      downloadPercent: progressTracker.update(chunk),
      ffmpegTimeSeconds: parseFfmpegTimeSeconds(chunk),
    });
    if (overallPercent == null || overallPercent === lastPersistedPercent) {
      return;
    }

    lastPersistedPercent = overallPercent;
    void updateYoutubeImportJobStatus(jobId, { progressPercent: overallPercent });
  };

  await runSpawnCollecting(
    'yt-dlp',
    [
      ...buildYtDlpBaseArgs(),
      '--no-playlist',
      '--newline',
      '--http-chunk-size',
      YT_DLP_IMPORT_HTTP_CHUNK_SIZE,
      '--concurrent-fragments',
      String(YT_DLP_IMPORT_CONCURRENT_FRAGMENTS),
      '-f',
      YT_DLP_IMPORT_DOWNLOAD_FORMAT,
      '--merge-output-format',
      'mp4',
      '--retries',
      '5',
      '--fragment-retries',
      '10',
      '--extractor-retries',
      '5',
      '--write-info-json',
      '-o',
      outputTemplate,
      watchUrl,
    ],
    'yt-dlp source download',
    {
      onStderrChunk: handleDownloadProgressChunk,
      onStdoutChunk: handleDownloadProgressChunk,
      isCancelled: () => isImportJobCancelled(jobId),
    }
  );

  return readDownloadMetadata(workDir, jobId);
}

async function trimDownloadedSource(
  job: YoutubeImportJob,
  download: {
    downloadedPath: string;
    downloadedDurationSeconds: number;
  },
  workDir: string,
  jobId: string
): Promise<string> {
  const { relativeStart, relativeEnd } = computeTrimOffsets({
    jobStartSeconds: job.startSeconds,
    jobEndSeconds: job.endSeconds,
    downloadedDurationSeconds: download.downloadedDurationSeconds,
  });
  const trimDurationSeconds = relativeEnd - relativeStart;

  const trimmedPath = join(workDir, TRIMMED_BASENAME);

  if (job.smartCut) {
    await trimWithSmartCut({
      inputPath: download.downloadedPath,
      outputPath: trimmedPath,
      workDir,
      relativeStart,
      relativeEnd,
      durationSeconds: download.downloadedDurationSeconds,
      isCancelled: () => isImportJobCancelled(jobId),
    });
  } else {
    await runSpawnCollecting(
      'ffmpeg',
      [
        '-hide_banner',
        '-nostdin',
        '-loglevel',
        'error',
        '-ss',
        String(relativeStart),
        '-i',
        download.downloadedPath,
        '-t',
        String(trimDurationSeconds),
        '-c',
        'copy',
        '-y',
        trimmedPath,
      ],
      'ffmpeg stream-copy trim',
      { isCancelled: () => isImportJobCancelled(jobId) }
    );
  }

  const trimmedStat = await stat(trimmedPath);
  if (trimmedStat.size <= 0) {
    throw new Error('ffmpeg trim produced an empty output file');
  }

  return trimmedPath;
}

/**
 * Executes a single YouTube import/trim job end to end: downloads the full
 * source video, trims the requested range with a local ffmpeg pass, uploads
 * the result to R2, and hands off to the standard upload/distribution
 * pipeline. Updates the job's status/progress as it proceeds so callers
 * polling `getYoutubeImportJobById` see live progress.
 * @param jobId - YoutubeImportJob id to execute. Must already exist with
 *   status `pending` or `downloading` (after atomic claim).
 */
export async function runYoutubeImportJob(jobId: string): Promise<void> {
  let workDir: string | null = null;

  try {
    console.info(`[runYoutubeImportJob] Starting job ${jobId}`);
    const job = await getYoutubeImportJobById(jobId);
    if (!job || (job.status !== 'pending' && job.status !== 'downloading')) {
      return;
    }

    workDir = await createImportWorkDir();

    if (await isImportJobCancelled(jobId)) {
      return;
    }

    if (job.status === 'pending') {
      await updateYoutubeImportJobStatus(jobId, { status: 'downloading', progressPercent: 0 });
    }

    const download = await downloadYoutubeSource(job, workDir, jobId);

    if (await isImportJobCancelled(jobId)) {
      return;
    }

    await updateYoutubeImportJobStatus(jobId, {
      status: 'trimming',
      progressPercent: DOWNLOAD_PROGRESS_MAX,
    });
    const trimmedPath = await trimDownloadedSource(job, download, workDir, jobId);

    if (await isImportJobCancelled(jobId)) {
      return;
    }

    await updateYoutubeImportJobStatus(jobId, {
      status: 'uploading',
      progressPercent: TRIM_PROGRESS,
    });
    const r2Key = buildYoutubeImportUploadKey(job.userId, job.youtubeVideoId);
    await uploadLocalFileToR2(trimmedPath, r2Key, 'video/mp4');

    if (await isImportJobCancelled(jobId)) {
      return;
    }

    await updateYoutubeImportJobStatus(jobId, { progressPercent: UPLOAD_PROGRESS });
    const uploadJob = await createUploadJob({
      userId: job.userId,
      draftId: job.draftId,
      r2Key,
    });

    await updateYoutubeImportJobStatus(jobId, { r2Key, uploadJobId: uploadJob.id });

    const latestImportJob = await getYoutubeImportJobById(jobId);
    if (latestImportJob?.distributeQueued) {
      await distributeStagedYoutubeImportUpload(
        { ...latestImportJob, uploadJobId: uploadJob.id, r2Key },
        job.userId
      );
    } else {
      await updateUploadJobStatus(uploadJob.id, 'uploading');
    }

    await updateYoutubeImportJobStatus(jobId, {
      status: 'completed',
      progressPercent: 100,
      errorMessage: null,
    });
  } catch (error) {
    if (error instanceof YoutubeImportJobCancelledError) {
      return;
    }
    if (await isImportJobCancelled(jobId)) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(`[runYoutubeImportJob] Job ${jobId} failed:`, message);
    await updateYoutubeImportJobStatus(jobId, {
      status: 'failed',
      errorMessage: message,
    }).catch((updateErr) => {
      console.error(`[runYoutubeImportJob] Failed to mark job ${jobId} as failed:`, updateErr);
    });
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch((cleanupErr) => {
        console.error(
          `[runYoutubeImportJob] Failed to remove temp work dir ${workDir}:`,
          cleanupErr
        );
      });
    }
  }
}
