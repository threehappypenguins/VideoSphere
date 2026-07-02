import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

/**
 * Spawns a child process for YouTube import tooling (`yt-dlp`, `ffprobe`).
 * @param command - Executable name on `PATH`.
 * @param args - Argument vector.
 * @param options - Spawn options (stdio is fixed to ignore/pipe/pipe by callers).
 * @returns Child process handle.
 */
export function spawnProcess(
  command: string,
  args: readonly string[],
  options: SpawnOptions
): ChildProcess {
  return spawn(command, args, options);
}
