import type { Livestream, LivestreamStatus } from '@/types';

/** Poll interval for the livestreams list when near-term broadcasts need reconciliation updates. */
export const LIVESTREAM_LIST_POLL_INTERVAL_MS = 60_000;

/** How far ahead of now a scheduled start still triggers list polling. */
export const LIVESTREAM_NEAR_TERM_WINDOW_MS = 4 * 60 * 60 * 1000;

/** Grace period after scheduled start to keep polling while status transitions to live/ended. */
export const LIVESTREAM_RECONCILE_GRACE_AFTER_START_MS = 60 * 60 * 1000;

const RECONCILE_POLL_STATUSES = new Set<LivestreamStatus>(['scheduled', 'live']);

/**
 * Returns whether a livestream's scheduled start falls in the near-term reconciliation window.
 * @param livestream - Livestream row from the list API.
 * @param nowMs - Reference time in milliseconds (defaults to `Date.now()`).
 * @returns True when polling may surface a scheduled→live or key-slot promotion update.
 */
export function isNearTermLivestreamForReconciliation(
  livestream: Pick<Livestream, 'status' | 'scheduledStartTime'>,
  nowMs: number = Date.now()
): boolean {
  if (!RECONCILE_POLL_STATUSES.has(livestream.status)) {
    return false;
  }

  const startMs = Date.parse(livestream.scheduledStartTime ?? '');
  if (Number.isNaN(startMs)) {
    return false;
  }

  const windowStart = nowMs - LIVESTREAM_RECONCILE_GRACE_AFTER_START_MS;
  const windowEnd = nowMs + LIVESTREAM_NEAR_TERM_WINDOW_MS;
  return startMs >= windowStart && startMs <= windowEnd;
}

/**
 * Whether the livestreams list should poll while the page is open.
 * @param livestreams - Current livestreams from the list API.
 * @param nowMs - Reference time in milliseconds (defaults to `Date.now()`).
 * @returns True when at least one row is in the near-term reconciliation window.
 */
export function shouldPollLivestreamsForReconciliation(
  livestreams: readonly Pick<Livestream, 'status' | 'scheduledStartTime'>[],
  nowMs: number = Date.now()
): boolean {
  return livestreams.some((livestream) => isNearTermLivestreamForReconciliation(livestream, nowMs));
}
