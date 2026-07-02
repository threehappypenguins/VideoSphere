/**
 * Maps common yt-dlp stderr output to user-facing import errors.
 * @param stderr - Raw stderr from a failed yt-dlp process.
 * @returns Friendly message when recognized, otherwise `null`.
 */
export function getUserFriendlyYtDlpErrorMessage(stderr: string): string | null {
  const normalized = stderr.toLowerCase();

  if (normalized.includes('private video')) {
    return 'This video is private. Make it public or unlisted on YouTube before importing.';
  }

  return null;
}

/**
 * Builds an Error from a failed yt-dlp child process, preferring a friendly message when known.
 * @param label - Human-readable process label for fallback errors.
 * @param code - Process exit code, if available.
 * @param stderrChunks - Captured stderr output chunks.
 * @returns Error suitable for API responses and UI display.
 */
export function buildYtDlpProcessError(
  label: string,
  code: number | null,
  stderrChunks: Buffer[]
): Error {
  const detail = Buffer.concat(stderrChunks).toString('utf8').trim();
  const friendly = getUserFriendlyYtDlpErrorMessage(detail);
  if (friendly) {
    return new Error(friendly);
  }

  const codeLabel = code == null ? 'unknown' : String(code);
  const message = detail
    ? `${label} failed (exit ${codeLabel}): ${detail}`
    : `${label} failed (exit ${codeLabel})`;
  return new Error(message);
}
