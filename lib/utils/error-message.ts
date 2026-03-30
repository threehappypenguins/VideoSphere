/**
 * Prefer the abort `reason` when fetch/S3 rejects with `AbortError` (Node/undici).
 */
export function messageFromThrown(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError' && error.cause instanceof Error) {
      return error.cause.message;
    }
    return error.message;
  }
  return String(error);
}
