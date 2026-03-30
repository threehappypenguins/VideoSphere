/**
 * Heuristic classifier for whether a persisted platform upload failure is worth retrying.
 * Used by upload history and retry routes without pulling in the distribution pipeline.
 */

export interface RetryabilityAssessment {
  retryable: boolean;
  reason: string;
}

function extractHttpStatusFromErrorMessage(errorMessage: string): number | null {
  const match = /\(HTTP\s+(\d{3})\)/i.exec(errorMessage);
  if (!match) return null;
  const n = Number.parseInt(match[1] ?? '', 10);
  return Number.isFinite(n) ? n : null;
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

/**
 * Heuristic classifier for whether a persisted platform failure is worth retrying.
 * We intentionally limit retries to likely-transient failures (network, timeout, 5xx, 429).
 */
export function assessPlatformUploadRetryability(
  errorMessage: string | null
): RetryabilityAssessment {
  if (!errorMessage || errorMessage.trim() === '') {
    return { retryable: false, reason: 'No error detail available for retry evaluation.' };
  }

  const normalized = errorMessage.toLowerCase();
  const status = extractHttpStatusFromErrorMessage(errorMessage);

  if (status !== null) {
    if (status === 429 || status === 408 || status >= 500) {
      return { retryable: true, reason: `HTTP ${status} is typically transient.` };
    }
    if (status === 401 || status === 403) {
      return {
        retryable: false,
        reason: `HTTP ${status} requires account/action, not a blind retry.`,
      };
    }
    if (status === 400 || status === 404 || status === 409 || status === 422) {
      return {
        retryable: false,
        reason: `HTTP ${status} is generally a permanent request/content issue.`,
      };
    }
  }

  if (
    includesAny(normalized, [
      'quota',
      'allowance',
      'insufficient',
      'forbidden',
      'permission',
      'invalid_grant',
      'token missing',
      'refresh token is missing',
      'reconnect',
      'no connected',
      'account no longer exists',
      'privacy',
      'category invalid',
    ])
  ) {
    return { retryable: false, reason: 'Failure indicates auth/quota/config action is required.' };
  }

  if (
    includesAny(normalized, [
      'network',
      'fetch failed',
      'timed out',
      'timeout',
      'econnreset',
      'eai_again',
      'socket hang up',
      'rate limit',
      'temporar',
      'service unavailable',
      'too many requests',
    ])
  ) {
    return { retryable: true, reason: 'Failure looks transient (network/rate-limit/timeout).' };
  }

  return { retryable: false, reason: 'Failure does not match known transient retry conditions.' };
}
