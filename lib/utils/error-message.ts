/**
 * Prefer the abort `reason` when fetch/S3 rejects with `AbortError` (Node/undici).
 * `AbortController.abort(reason)` may set `cause` to a non-Error (e.g. string); preserve it when present.
 */
export function messageFromThrown(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError' && error.cause != null) {
      return error.cause instanceof Error ? error.cause.message : String(error.cause);
    }
    return error.message;
  }
  return String(error);
}
