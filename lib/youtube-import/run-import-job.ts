import { randomUUID } from 'node:crypto';
import { readFile, mkdir, mkdtemp, rm, stat } from '@/lib/youtube-import/import-job-fs';
import { join } from 'node:path';
import { uploadLocalFileToR2 } from '@/lib/r2';
import { createUploadJob, updateUploadJobStatus } from '@/lib/repositories/upload-jobs';
import {
  getYoutubeImportJobById,
  updateYoutubeImportJobStatus,
} from '@/lib/repositories/youtube-import-jobs';
import { buildYouTubeWatchUrl } from '@/lib/youtube-import/resolve-source';
import { distributeStagedYoutubeImportUpload } from '@/lib/youtube-import/queue-import-distribute';
import { spawnProcess } from '@/lib/youtube-import/spawn-process';
import { buildYtDlpBaseArgs } from '@/lib/youtube-import/yt-dlp-args';
import { buildYtDlpProcessError } from '@/lib/youtube-import/yt-dlp-errors';
import type { YoutubeImportJob } from '@/types';

const DEFAULT_YT_IMPORT_WORKDIR = '/tmp/yt-import';
const DOWNLOADED_BASENAME = 'download';
const TRIMMED_BASENAME = 'trimmed.mp4';
const DOWNLOAD_PROGRESS_MAX = 70;
const TRIM_PROGRESS = 85;
const UPLOAD_PROGRESS = 95;
/** Initial cancel poll interval while subprocesses start (ms). */
const IMPORT_CANCEL_POLL_INITIAL_MS = 1_000;
/** Maximum cancel poll interval during long downloads/trims (ms). */
const IMPORT_CANCEL_POLL_MAX_MS = 5_000;
/** Multiplier applied after each cancel poll that finds the job still active. */
const IMPORT_CANCEL_POLL_BACKOFF_FACTOR = 1.5;

/**
 * Thrown when an import subprocess is stopped because the job was cancelled.
 */
class YoutubeImportJobCancelledError extends Error {
  constructor() {
    super('YouTube import job was cancelled');
    this.name = 'YoutubeImportJobCancelledError';
  }
}

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
 * Parses the latest non-negative `time=HH:MM:SS.ms` value from ffmpeg stderr.
 * Section downloads mux through ffmpeg and may not emit `[download] …%` until the end.
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
 * @param input - Parsed progress signals and clip duration.
 * @returns Overall job percent for the download phase, or `null` when no signal is present.
 */
export function computeDownloadPhaseProgressPercent(input: {
  downloadPercent: number | null;
  ffmpegTimeSeconds: number | null;
  sectionDurationSeconds: number;
  maxPercent?: number;
}): number | null {
  const maxPercent = input.maxPercent ?? DOWNLOAD_PROGRESS_MAX;
  let ratio: number | null = null;

  if (input.downloadPercent != null) {
    ratio = Math.min(1, Math.max(0, input.downloadPercent / 100));
  } else if (
    input.ffmpegTimeSeconds != null &&
    input.sectionDurationSeconds > 0 &&
    input.ffmpegTimeSeconds >= 0
  ) {
    ratio = Math.min(1, input.ffmpegTimeSeconds / input.sectionDurationSeconds);
  }

  if (ratio == null) {
    return null;
  }

  return Math.min(maxPercent, Math.max(1, Math.floor(ratio * maxPercent)));
}

/**
 * Computes ffmpeg copy-trim offsets inside a section download.
 * @param input - Requested trim points and the section yt-dlp actually fetched.
 * @returns Relative `-ss`/`-to` values for the downloaded file.
 */
export function computeTrimOffsets(input: {
  jobStartSeconds: number;
  jobEndSeconds: number;
  sectionStartSeconds: number;
  downloadedDurationSeconds: number;
}): { relativeStart: number; relativeEnd: number } {
  const relativeStart = Math.max(0, input.jobStartSeconds - input.sectionStartSeconds);
  const relativeEnd = Math.min(
    input.downloadedDurationSeconds,
    input.jobEndSeconds - input.sectionStartSeconds
  );

  if (
    !Number.isFinite(relativeStart) ||
    !Number.isFinite(relativeEnd) ||
    relativeEnd <= relativeStart
  ) {
    throw new Error('Trim range is empty after section download');
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

function spawnExitError(label: string, code: number | null, stderrChunks: Buffer[]): Error {
  return buildYtDlpProcessError(label, code, stderrChunks);
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
  await new Promise<void>((resolve, reject) => {
    const child = spawnProcess(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stderrChunks: Buffer[] = [];
    let stoppedForCancel = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let nextPollDelayMs = IMPORT_CANCEL_POLL_INITIAL_MS;

    const stopPolling = () => {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    };

    const rejectIfCancelled = async (): Promise<boolean> => {
      if (stoppedForCancel) {
        return true;
      }
      if (!options?.isCancelled) {
        return false;
      }
      if (await options.isCancelled()) {
        stoppedForCancel = true;
        child.kill('SIGTERM');
        return true;
      }
      return false;
    };

    const scheduleCancelPoll = () => {
      pollTimer = setTimeout(() => {
        void (async () => {
          if (await rejectIfCancelled()) {
            return;
          }
          nextPollDelayMs = Math.min(
            Math.round(nextPollDelayMs * IMPORT_CANCEL_POLL_BACKOFF_FACTOR),
            IMPORT_CANCEL_POLL_MAX_MS
          );
          scheduleCancelPoll();
        })();
      }, nextPollDelayMs);
    };

    if (options?.isCancelled) {
      void rejectIfCancelled();
      scheduleCancelPoll();
    }

    child.stdout.on('data', (chunk: Buffer) => {
      options?.onStdoutChunk?.(chunk.toString('utf8'));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      options?.onStderrChunk?.(chunk.toString('utf8'));
    });

    child.on('close', (code) => {
      stopPolling();
      void (async () => {
        if (stoppedForCancel || (await options?.isCancelled?.())) {
          reject(new YoutubeImportJobCancelledError());
          return;
        }
        if (code !== 0) {
          reject(spawnExitError(label, code, stderrChunks));
          return;
        }
        resolve();
      })();
    });
    child.on('error', (error) => {
      stopPolling();
      reject(error);
    });
  });
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

function parseSectionStartFromInfoJson(info: Record<string, unknown>): number | null {
  if (typeof info.section_start === 'number' && Number.isFinite(info.section_start)) {
    return info.section_start;
  }

  const requested = info.requested_downloads;
  if (Array.isArray(requested) && requested.length > 0) {
    const first = requested[0];
    if (typeof first === 'object' && first !== null) {
      const sectionStart = (first as Record<string, unknown>).section_start;
      if (typeof sectionStart === 'number' && Number.isFinite(sectionStart)) {
        return sectionStart;
      }
    }
  }

  return null;
}

async function readDownloadMetadata(
  workDir: string,
  jobId: string
): Promise<{
  downloadedPath: string;
  sectionStartSeconds: number;
  downloadedDurationSeconds: number;
}> {
  const downloadedPath = join(workDir, `${DOWNLOADED_BASENAME}.mp4`);
  const infoPath = join(workDir, `${DOWNLOADED_BASENAME}.info.json`);
  const isCancelled = () => isImportJobCancelled(jobId);

  const [infoRaw, durationRaw] = await Promise.all([
    readFile(infoPath, 'utf8'),
    runSpawnStdout(
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
    ),
  ]);

  const info = JSON.parse(infoRaw) as Record<string, unknown>;
  const sectionStartSeconds = parseSectionStartFromInfoJson(info);
  if (sectionStartSeconds == null) {
    throw new Error('yt-dlp info JSON did not include section_start metadata');
  }

  const downloadedDurationSeconds = Number(durationRaw);
  if (!Number.isFinite(downloadedDurationSeconds) || downloadedDurationSeconds <= 0) {
    throw new Error('Downloaded section has invalid duration');
  }

  return { downloadedPath, sectionStartSeconds, downloadedDurationSeconds };
}

async function isImportJobCancelled(jobId: string): Promise<boolean> {
  const current = await getYoutubeImportJobById(jobId);
  return current?.status === 'cancelled';
}

async function downloadYoutubeSection(
  job: YoutubeImportJob,
  workDir: string,
  jobId: string
): Promise<{
  downloadedPath: string;
  sectionStartSeconds: number;
  downloadedDurationSeconds: number;
}> {
  const watchUrl = buildYouTubeWatchUrl(job.youtubeVideoId);
  const outputTemplate = join(workDir, `${DOWNLOADED_BASENAME}.%(ext)s`);
  const section = `*${job.startSeconds}-${job.endSeconds}`;

  let lastPersistedPercent = -1;
  const sectionDurationSeconds = Math.max(1, job.endSeconds - job.startSeconds);

  void updateYoutubeImportJobStatus(jobId, { progressPercent: 1 });

  const handleDownloadProgressChunk = (chunk: string) => {
    const overallPercent = computeDownloadPhaseProgressPercent({
      downloadPercent: parseYtDlpDownloadPercent(chunk),
      ffmpegTimeSeconds: parseFfmpegTimeSeconds(chunk),
      sectionDurationSeconds,
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
      '--download-sections',
      section,
      '-f',
      'bv*+ba/b',
      '--merge-output-format',
      'mp4',
      '--retries',
      '3',
      '--fragment-retries',
      '3',
      '--write-info-json',
      '-o',
      outputTemplate,
      watchUrl,
    ],
    'yt-dlp section download',
    {
      onStderrChunk: handleDownloadProgressChunk,
      onStdoutChunk: handleDownloadProgressChunk,
      isCancelled: () => isImportJobCancelled(jobId),
    }
  );

  return readDownloadMetadata(workDir, jobId);
}

async function trimDownloadedSection(
  job: YoutubeImportJob,
  download: {
    downloadedPath: string;
    sectionStartSeconds: number;
    downloadedDurationSeconds: number;
  },
  workDir: string,
  jobId: string
): Promise<string> {
  const { relativeStart, relativeEnd } = computeTrimOffsets({
    jobStartSeconds: job.startSeconds,
    jobEndSeconds: job.endSeconds,
    sectionStartSeconds: download.sectionStartSeconds,
    downloadedDurationSeconds: download.downloadedDurationSeconds,
  });

  const trimmedPath = join(workDir, TRIMMED_BASENAME);

  await runSpawnCollecting(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'error',
      '-ss',
      String(relativeStart),
      '-to',
      String(relativeEnd),
      '-i',
      download.downloadedPath,
      '-c',
      'copy',
      '-y',
      trimmedPath,
    ],
    'ffmpeg stream-copy trim',
    { isCancelled: () => isImportJobCancelled(jobId) }
  );

  const trimmedStat = await stat(trimmedPath);
  if (trimmedStat.size <= 0) {
    throw new Error('ffmpeg trim produced an empty output file');
  }

  return trimmedPath;
}

/**
 * Executes a single YouTube import/trim job end to end: downloads the
 * requested time range, trims it with a stream-copy ffmpeg pass, uploads
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

    const download = await downloadYoutubeSection(job, workDir, jobId);

    if (await isImportJobCancelled(jobId)) {
      return;
    }

    await updateYoutubeImportJobStatus(jobId, {
      status: 'trimming',
      progressPercent: DOWNLOAD_PROGRESS_MAX,
    });
    const trimmedPath = await trimDownloadedSection(job, download, workDir, jobId);

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
