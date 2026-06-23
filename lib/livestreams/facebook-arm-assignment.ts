import { resolveAutoPromoteToMainKeyMinutes } from '@/lib/livestreams/auto-promote-main-key';
import type { Livestream } from '@/types';

/**
 * Whether a newly scheduled Facebook livestream should arm immediately or defer until
 * the auto-preparation window before start.
 * @property kind - `immediate` for the first queued Facebook livestream; `deferred` when another is already scheduled or live.
 */
export type FacebookArmScheduleDecision = { kind: 'immediate' } | { kind: 'deferred' };

/**
 * Decides whether a draft Facebook livestream should arm on schedule or wait for the
 * auto-preparation window when another Facebook livestream is already queued.
 * @param otherScheduledFacebookLivestreams - Other scheduled or live Facebook-targeted rows for this user.
 * @returns Immediate arm for the first row; deferred arm when another occupies the queue.
 */
export function decideFacebookArmForNewSchedule(
  otherScheduledFacebookLivestreams: Pick<Livestream, 'id'>[]
): FacebookArmScheduleDecision {
  if (otherScheduledFacebookLivestreams.length === 0) {
    return { kind: 'immediate' };
  }
  return { kind: 'deferred' };
}

/**
 * True when a scheduled Facebook livestream is waiting for deferred arm (no LiveVideo yet).
 * @param livestream - Livestream row or editor snapshot.
 * @returns Whether deferred Facebook arm applies to this row.
 */
export function isFacebookDeferredArmPending(
  livestream: Pick<
    Livestream,
    | 'status'
    | 'targets'
    | 'facebookLiveVideoId'
    | 'autoPromoteToMainKey'
    | 'autoPromoteToMainKeyMinutes'
  >
): boolean {
  if (livestream.status !== 'scheduled') {
    return false;
  }
  if (!livestream.targets.includes('facebook')) {
    return false;
  }
  if (livestream.facebookLiveVideoId?.trim()) {
    return false;
  }
  if (livestream.autoPromoteToMainKey === false) {
    return false;
  }
  return livestream.autoPromoteToMainKey === true || livestream.autoPromoteToMainKeyMinutes != null;
}

/**
 * Computes the wall-clock instant when a queued Facebook livestream should create its LiveVideo.
 * @param livestream - Livestream row or editor snapshot.
 * @returns Deferred arm time, or null when auto-preparation does not apply.
 */
export function computeFacebookDeferredArmAt(
  livestream: Pick<
    Livestream,
    | 'status'
    | 'targets'
    | 'scheduledStartTime'
    | 'facebookLiveVideoId'
    | 'autoPromoteToMainKey'
    | 'autoPromoteToMainKeyMinutes'
  >
): Date | null {
  if (!isFacebookDeferredArmPending(livestream)) {
    return null;
  }

  const startMs = Date.parse(livestream.scheduledStartTime ?? '');
  if (Number.isNaN(startMs)) {
    return null;
  }

  const leadMs = resolveAutoPromoteToMainKeyMinutes(livestream) * 60_000;
  return new Date(startMs - leadMs);
}

/**
 * User-facing error when scheduling an additional Facebook livestream with auto-preparation disabled.
 * @returns Schedule rejection copy for the API and UI.
 */
export function facebookDeferredArmDisabledMessage(): string {
  return 'Enable automatic stream preparation before scheduling another Facebook livestream. Only one Facebook stream can be prepared at a time; additional streams receive their ingest URL automatically before start when preparation is enabled.';
}
