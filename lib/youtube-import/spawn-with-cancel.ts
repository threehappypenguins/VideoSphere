import { spawnProcess } from '@/lib/youtube-import/spawn-process';
import { buildYtDlpProcessError } from '@/lib/youtube-import/yt-dlp-errors';

/** Initial cancel poll interval while subprocesses start (ms). */
const IMPORT_CANCEL_POLL_INITIAL_MS = 1_000;
/** Maximum cancel poll interval during long downloads/trims (ms). */
const IMPORT_CANCEL_POLL_MAX_MS = 5_000;
/** Multiplier applied after each cancel poll that finds the job still active. */
const IMPORT_CANCEL_POLL_BACKOFF_FACTOR = 1.5;

/**
 * Thrown when an import subprocess is stopped because the job was cancelled.
 */
export class YoutubeImportJobCancelledError extends Error {
  constructor() {
    super('YouTube import job was cancelled');
    this.name = 'YoutubeImportJobCancelledError';
  }
}

/**
 * Runs a subprocess and optionally polls for import-job cancellation, killing the
 * child with SIGTERM when the job is cancelled.
 * @param command - Executable name or path.
 * @param args - Argument vector.
 * @param label - Human-readable label for error messages.
 * @param options - Optional stdout/stderr handlers and cancellation polling callback.
 * @returns Resolves when the child exits zero; rejects on failure or cancellation.
 */
export async function runSpawnWithCancel(
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
          reject(buildYtDlpProcessError(label, code, stderrChunks));
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
