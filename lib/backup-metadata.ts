import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Readable as ReadableCtor } from 'node:stream';
import {
  backupExtensionFromContentType,
  normalizeBackupFileNameSettings,
  resolveBackupDatePrefixCalendarDate,
} from '@/lib/backup-filename';
import type { BackupFileNameSettings } from '@/types';

const BACKUP_METADATA_SOURCE_BASENAME = 'source';
const BACKUP_METADATA_OUTPUT_BASENAME = 'output';

/** Metadata atoms written into backup MP4/MOV files via ffmpeg. */
export interface BackupInjectedMetadata {
  /** Video title (`title` atom). */
  title?: string;
  /** Album artist (`album_artist` atom). */
  albumArtist?: string;
  /** Album (`album` atom). */
  album?: string;
  /** Genre (`genre` atom). */
  genre?: string;
  /** Year (`date` atom), typically four digits. */
  year?: string;
}

/** Prepared backup video stream after metadata injection. */
export interface PreparedBackupMetadataVideo {
  /** Stream of the metadata-injected container file. */
  stream: ReadableStream<Uint8Array>;
  /** Byte length of {@link stream}. */
  contentLength: number;
  /** MIME type of {@link stream}, matching the source container (e.g. MP4 or QuickTime). */
  contentType: string;
  /**
   * Releases temp staging files. Safe to call after the stream is fully consumed; required when an
   * upload fails before reading {@link stream} (e.g. resumable session init errors).
   */
  dispose: () => Promise<void>;
}

/**
 * Returns whether a MIME type supports MP4-style atom metadata injection without re-encoding.
 * @param contentType - Uploaded video MIME type.
 * @returns True for MP4 and QuickTime containers.
 */
export function isBackupMetadataInjectableContentType(contentType: string | undefined): boolean {
  const ct = (contentType ?? '').toLowerCase();
  return ct.includes('mp4') || ct.includes('quicktime');
}

/**
 * Resolves the upload MIME type for a metadata-injected backup, preserving the source container.
 * @param sourceContentType - MIME type of the uploaded source object.
 * @returns Output MIME type for backup upload (MP4 or QuickTime).
 */
export function resolveBackupMetadataOutputContentType(
  sourceContentType: string | undefined
): string {
  const ext = backupExtensionFromContentType(sourceContentType);
  if (ext === 'mov') {
    return 'video/quicktime';
  }
  if (ext === 'mp4') {
    return 'video/mp4';
  }
  return sourceContentType?.trim() || 'video/mp4';
}

function backupMetadataStagingExtension(sourceContentType: string | undefined): string {
  return backupExtensionFromContentType(sourceContentType);
}

function trimMetadataField(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Resolves injectable backup metadata from draft backup settings and the backup title.
 * Title and year are derived; album artist, album, and genre come from stored settings.
 * @param input - Backup title and naming settings from the draft.
 * @returns Metadata fields to pass to ffmpeg.
 */
export function resolveBackupInjectedMetadata(input: {
  title: string;
  settings?: BackupFileNameSettings;
}): BackupInjectedMetadata {
  const settings = normalizeBackupFileNameSettings(input.settings);
  const calendarDate = resolveBackupDatePrefixCalendarDate(settings);
  const year = calendarDate.slice(0, 4);

  return {
    title: trimMetadataField(input.title) ?? undefined,
    albumArtist: trimMetadataField(settings.albumArtist),
    album: trimMetadataField(settings.album),
    genre: trimMetadataField(settings.genre),
    year: /^\d{4}$/.test(year) ? year : undefined,
  };
}

/**
 * Returns whether backup distribution should run ffmpeg metadata injection.
 * @param settings - Draft backup naming settings.
 * @param contentType - Uploaded video MIME type.
 * @returns True when metadata injection is enabled and the container supports it.
 */
export function shouldInjectBackupMetadata(
  settings: BackupFileNameSettings | undefined,
  contentType: string | undefined
): boolean {
  const normalized = normalizeBackupFileNameSettings(settings);
  return normalized.metadataEnabled === true && isBackupMetadataInjectableContentType(contentType);
}

function escapeFfmpegMetadataValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/=/g, '\\=').replace(/:/g, '\\:');
}

function buildFfmpegMetadataArgs(metadata: BackupInjectedMetadata): string[] {
  const args: string[] = [];

  if (metadata.title) {
    args.push('-metadata', `title=${escapeFfmpegMetadataValue(metadata.title)}`);
  }
  if (metadata.albumArtist) {
    args.push('-metadata', `album_artist=${escapeFfmpegMetadataValue(metadata.albumArtist)}`);
  }
  if (metadata.album) {
    args.push('-metadata', `album=${escapeFfmpegMetadataValue(metadata.album)}`);
  }
  if (metadata.genre) {
    args.push('-metadata', `genre=${escapeFfmpegMetadataValue(metadata.genre)}`);
  }
  if (metadata.year) {
    args.push('-metadata', `date=${escapeFfmpegMetadataValue(metadata.year)}`);
  }

  return args;
}

function ffmpegExitError(code: number | null, stderrChunks: Buffer[]): Error {
  const detail = Buffer.concat(stderrChunks).toString('utf8').trim();
  const codeLabel = code == null ? 'unknown' : String(code);
  const message = detail
    ? `ffmpeg metadata injection failed (exit ${codeLabel}): ${detail}`
    : `ffmpeg metadata injection failed (exit ${codeLabel})`;
  return new Error(message);
}

function validateByteCount(actual: number, expected: number, label: string): void {
  if (expected <= 4096) {
    return;
  }

  const minSize = Math.max(4096, Math.floor(expected * 0.9));
  if (actual < minSize) {
    throw new Error(`${label} (${actual} bytes) is much smaller than expected (${expected} bytes)`);
  }
}

function wrapStreamWithCleanup(
  stream: ReadableStream<Uint8Array>,
  cleanup: () => Promise<void>
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  let cleanedUp = false;
  let readerReleased = false;

  const runCleanup = async () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    await cleanup();
  };

  const releaseReader = () => {
    if (readerReleased) {
      return;
    }
    readerReleased = true;
    reader.releaseLock();
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          releaseReader();
          await runCleanup();
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        controller.error(err instanceof Error ? err : new Error(String(err)));
        releaseReader();
        await runCleanup();
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } catch {
        // Ignore errors while cancelling the underlying stream.
      } finally {
        releaseReader();
        await runCleanup();
      }
    },
  });
}

/** On-disk artifact produced by a single ffmpeg metadata injection pass. */
interface PreparedBackupMetadataArtifact {
  /** Temp directory containing staged input and output files. */
  workDir: string;
  /** Path to the metadata-injected output file inside {@link workDir}. */
  outputPath: string;
  /** Byte length of {@link outputPath}. */
  contentLength: number;
  /** MIME type of {@link outputPath}, matching the source container. */
  contentType: string;
}

/**
 * Stages the source to a temp file and runs ffmpeg once to produce a seekable metadata-injected file.
 * @param input - Node readable source, expected byte length, source MIME type, metadata fields, and optional abort signal.
 * @returns Paths, size, and content type for the output file. Caller owns cleanup of {@link PreparedBackupMetadataArtifact.workDir}.
 */
async function prepareBackupMetadataArtifact(input: {
  source: Readable;
  expectedContentLength: number;
  sourceContentType?: string;
  metadata: BackupInjectedMetadata;
  signal?: AbortSignal;
}): Promise<PreparedBackupMetadataArtifact> {
  const extension = backupMetadataStagingExtension(input.sourceContentType);
  const contentType = resolveBackupMetadataOutputContentType(input.sourceContentType);
  const workDir = await mkdtemp(
    join(/* turbopackIgnore: true */ tmpdir(), 'videosphere-backup-meta-')
  );
  const inputPath = join(
    /* turbopackIgnore: true */ workDir,
    `${BACKUP_METADATA_SOURCE_BASENAME}.${extension}`
  );
  const outputPath = join(
    /* turbopackIgnore: true */ workDir,
    `${BACKUP_METADATA_OUTPUT_BASENAME}.${extension}`
  );

  try {
    await pipeline(input.source, createWriteStream(/* turbopackIgnore: true */ inputPath), {
      signal: input.signal,
    });

    const inputStat = await stat(inputPath);
    validateByteCount(inputStat.size, input.expectedContentLength, 'Backup metadata staging file');

    await runFfmpegMetadataCopy({
      inputPath,
      outputPath,
      metadata: input.metadata,
      signal: input.signal,
    });

    const { size } = await stat(outputPath);
    if (size <= 0) {
      throw new Error('ffmpeg metadata injection produced an empty output file');
    }

    validateByteCount(size, input.expectedContentLength, 'ffmpeg metadata injection output');

    return { workDir, outputPath, contentLength: size, contentType };
  } catch (err) {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

async function runFfmpegMetadataCopy(input: {
  inputPath: string;
  outputPath: string;
  metadata: BackupInjectedMetadata;
  signal?: AbortSignal;
}): Promise<void> {
  const args = [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-i',
    input.inputPath,
    '-map',
    '0',
    '-codec',
    'copy',
    ...buildFfmpegMetadataArgs(input.metadata),
    '-movflags',
    '+faststart',
    input.outputPath,
  ];

  const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const stderrChunks: Buffer[] = [];
  ffmpeg.stderr.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk);
  });

  let aborted = false;
  const onAbort = () => {
    aborted = true;
    ffmpeg.kill('SIGKILL');
  };

  const detachAbortListener = () => {
    input.signal?.removeEventListener('abort', onAbort);
  };

  if (input.signal?.aborted) {
    onAbort();
  } else if (input.signal) {
    input.signal.addEventListener('abort', onAbort, { once: true });
  }

  await new Promise<void>((resolve, reject) => {
    const finish = (callback: () => void) => {
      detachAbortListener();
      callback();
    };

    ffmpeg.on('close', (code) => {
      if (aborted) {
        finish(() => reject(new Error('Backup metadata injection aborted')));
        return;
      }
      if (code !== 0) {
        finish(() => reject(ffmpegExitError(code, stderrChunks)));
        return;
      }
      finish(resolve);
    });
    ffmpeg.on('error', (err) => {
      finish(() => reject(err));
    });
  });
}

/**
 * Stages the source stream to a short-lived temp file, runs ffmpeg with seekable input to write a
 * metadata-injected MP4 or MOV (`+faststart`, `-codec copy`), then returns the output file as a web
 * ReadableStream for backup upload. MP4/MOV sources usually place `moov` at the end of the file, so
 * piping into ffmpeg stdin cannot demux the full media; a seekable temp copy is required for reliable
 * metadata injection without re-encoding.
 * @param input - Node readable source, expected byte length, source MIME type, metadata fields, and optional abort signal.
 * @returns Upload stream, content length, preserved container MIME type, and {@link PreparedBackupMetadataVideo.dispose}.
 */
export async function prepareBackupMetadataVideoForUpload(input: {
  source: Readable;
  expectedContentLength: number;
  sourceContentType?: string;
  metadata: BackupInjectedMetadata;
  signal?: AbortSignal;
}): Promise<PreparedBackupMetadataVideo> {
  const artifact = await prepareBackupMetadataArtifact({
    source: input.source,
    expectedContentLength: input.expectedContentLength,
    sourceContentType: input.sourceContentType,
    metadata: input.metadata,
    signal: input.signal,
  });

  let cleanedUp = false;
  const cleanupWorkDir = async () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    await rm(artifact.workDir, { recursive: true, force: true }).catch(() => {});
  };

  const nodeReadable = createReadStream(/* turbopackIgnore: true */ artifact.outputPath);
  const webStream = ReadableCtor.toWeb(nodeReadable) as ReadableStream<Uint8Array>;

  return {
    stream: wrapStreamWithCleanup(webStream, cleanupWorkDir),
    contentLength: artifact.contentLength,
    contentType: artifact.contentType,
    dispose: async () => {
      await webStream.cancel().catch(() => {});
      await cleanupWorkDir();
    },
  };
}

/** Opens a readable source stream for backup metadata staging (typically one R2 GetObject per job). */
export type BackupMetadataSourceOpener = (
  signal?: AbortSignal
) => Promise<{ readable: Readable; contentLength: number; contentType: string }>;

/**
 * Runs ffmpeg metadata injection once per distribution job and fans the same output file to
 * multiple backup upload streams (Drive, SFTP, SMB).
 */
export class SharedBackupMetadataSession {
  private artifactPromise: Promise<PreparedBackupMetadataArtifact> | null = null;
  private cleanedUp = false;

  /**
   * @param openSource - Opens the R2 (or other) source stream; invoked at most once per session.
   * @param expectedContentLength - Source byte length from object HEAD metadata.
   * @param sourceContentType - MIME type of the source object (preserved on output).
   * @param metadata - Metadata atoms to inject into the output container.
   */
  constructor(
    private readonly openSource: BackupMetadataSourceOpener,
    private readonly expectedContentLength: number,
    private readonly sourceContentType: string | undefined,
    private readonly metadata: BackupInjectedMetadata
  ) {}

  /**
   * Returns an upload stream reading from the shared metadata-injected output file.
   * The first call stages the source and runs ffmpeg; later calls reuse the same output.
   * @param signal - Optional abort signal for staging and ffmpeg.
   * @returns Upload stream and content length. Call {@link dispose} after all uploads finish.
   */
  async openUploadStream(signal?: AbortSignal): Promise<PreparedBackupMetadataVideo> {
    const artifact = await this.ensureArtifact(signal);

    const nodeReadable = createReadStream(/* turbopackIgnore: true */ artifact.outputPath);
    const webStream = ReadableCtor.toWeb(nodeReadable) as ReadableStream<Uint8Array>;

    return {
      stream: webStream,
      contentLength: artifact.contentLength,
      contentType: artifact.contentType,
      dispose: async () => {
        await webStream.cancel().catch(() => {});
      },
    };
  }

  /**
   * Removes temp staging files. Safe to call after all uploads finish or on job teardown.
   */
  async dispose(): Promise<void> {
    await this.cleanupWorkDir();
  }

  private async ensureArtifact(signal?: AbortSignal): Promise<PreparedBackupMetadataArtifact> {
    if (!this.artifactPromise) {
      this.artifactPromise = this.prepareArtifact(signal);
    }
    return this.artifactPromise;
  }

  private async prepareArtifact(signal?: AbortSignal): Promise<PreparedBackupMetadataArtifact> {
    const source = await this.openSource(signal);
    return prepareBackupMetadataArtifact({
      source: source.readable,
      expectedContentLength: this.expectedContentLength,
      sourceContentType: this.sourceContentType ?? source.contentType,
      metadata: this.metadata,
      signal,
    });
  }

  private async cleanupWorkDir(): Promise<void> {
    if (this.cleanedUp) {
      return;
    }
    this.cleanedUp = true;

    if (!this.artifactPromise) {
      return;
    }

    try {
      const artifact = await this.artifactPromise;
      await rm(artifact.workDir, { recursive: true, force: true }).catch(() => {});
    } catch {
      // Preparation failed or was aborted; temp dir was already removed in prepareBackupMetadataArtifact.
    }
  }
}

/**
 * Creates a shared metadata session for a distribution job when backup metadata injection applies.
 * @param input - Source opener, object HEAD metadata, and injectable backup fields.
 * @returns A session when injection is enabled and the container supports it; otherwise null.
 */
export function createSharedBackupMetadataSession(input: {
  openSource: BackupMetadataSourceOpener;
  expectedContentLength: number;
  sourceContentType: string | undefined;
  backupNaming: BackupFileNameSettings | undefined;
  injectedMetadata: BackupInjectedMetadata;
}): SharedBackupMetadataSession | null {
  if (!shouldInjectBackupMetadata(input.backupNaming, input.sourceContentType)) {
    return null;
  }

  return new SharedBackupMetadataSession(
    input.openSource,
    input.expectedContentLength,
    input.sourceContentType,
    input.injectedMetadata
  );
}
