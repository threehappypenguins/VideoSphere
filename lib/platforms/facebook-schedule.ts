/** Minimum seconds from now for a scheduled Reels publish time. */
export const FACEBOOK_MIN_SCHEDULE_LEAD_SECONDS = 10 * 60;

/** Maximum seconds from now for a scheduled Reels publish time (~6 months). */
export const FACEBOOK_MAX_SCHEDULE_LEAD_SECONDS = 6 * 30 * 24 * 60 * 60;

/**
 * Validates a scheduled publish Unix timestamp for Facebook Reels.
 * @param scheduledPublishTime - Unix timestamp in seconds.
 * @param nowMs - Reference time in milliseconds (defaults to current time).
 * @returns Error message when invalid, or undefined when valid.
 */
export function validateFacebookScheduledPublishTime(
  scheduledPublishTime: number,
  nowMs: number = Date.now()
): string | undefined {
  const nowSec = Math.floor(nowMs / 1000);
  const minSec = nowSec + FACEBOOK_MIN_SCHEDULE_LEAD_SECONDS;
  const maxSec = nowSec + FACEBOOK_MAX_SCHEDULE_LEAD_SECONDS;
  if (!Number.isFinite(scheduledPublishTime)) {
    return 'Scheduled publish time must be a valid Unix timestamp.';
  }
  if (scheduledPublishTime < minSec) {
    return 'Scheduled publish time must be at least 10 minutes in the future.';
  }
  if (scheduledPublishTime > maxSec) {
    return 'Scheduled publish time must be within 6 months from now.';
  }
  return undefined;
}
