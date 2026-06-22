import { addDays, addMonths, startOfDay } from 'date-fns';

/** Minimum lead time before a scheduled publish/start time. */
export const SCHEDULE_MIN_LEAD_MINUTES = 10;

/** Maximum months in the future YouTube allows scheduling. */
export const YOUTUBE_MAX_SCHEDULE_LEAD_MONTHS = 12;

/** Maximum days in the future Facebook allows scheduling. */
export const FACEBOOK_MAX_SCHEDULE_LEAD_DAYS = 75;

/**
 * Platform whose schedule window applies.
 * @property youtube - Up to {@link YOUTUBE_MAX_SCHEDULE_LEAD_MONTHS} months ahead.
 * @property facebook - Up to {@link FACEBOOK_MAX_SCHEDULE_LEAD_DAYS} days ahead.
 */
export type SchedulePlatform = 'youtube' | 'facebook';

/**
 * Earliest selectable calendar day for schedulers (start of today, local time).
 * @param now - Reference instant.
 * @returns Start of the current local day.
 */
export function getScheduleMinDate(now: Date = new Date()): Date {
  return startOfDay(now);
}

/**
 * Latest selectable calendar day for a platform scheduler.
 * @param platform - Target platform (`youtube` or `facebook`).
 * @param now - Reference instant.
 * @returns Start of the last allowed local day.
 */
export function getScheduleMaxDate(platform: SchedulePlatform, now: Date = new Date()): Date {
  if (platform === 'youtube') {
    return startOfDay(addMonths(now, YOUTUBE_MAX_SCHEDULE_LEAD_MONTHS));
  }
  return startOfDay(addDays(now, FACEBOOK_MAX_SCHEDULE_LEAD_DAYS));
}

/**
 * Last millisecond of the latest allowed schedule day for a platform.
 * @param platform - Target platform (`youtube` or `facebook`).
 * @param now - Reference instant.
 * @returns End of the max schedule day in local time.
 */
export function getScheduleMaxDateTimeMs(
  platform: SchedulePlatform,
  now: Date = new Date()
): number {
  const maxDay = getScheduleMaxDate(platform, now);
  return maxDay.getTime() + 24 * 60 * 60 * 1000 - 1;
}

/**
 * Human-readable description of the latest allowed schedule lead for a platform.
 * @param platform - Target platform (`youtube` or `facebook`).
 * @returns Short phrase for UI help text (e.g. `12 months`, `75 days`).
 */
export function getScheduleMaxLeadLabel(platform: SchedulePlatform): string {
  return platform === 'youtube'
    ? `${YOUTUBE_MAX_SCHEDULE_LEAD_MONTHS} months`
    : `${FACEBOOK_MAX_SCHEDULE_LEAD_DAYS} days`;
}

function validateSchedulePublishAtIsoForPlatform(
  iso: string,
  platform: SchedulePlatform,
  now: Date = new Date()
): string | undefined {
  const parsedMs = Date.parse(iso);
  if (Number.isNaN(parsedMs)) {
    return 'Scheduled time must be a valid date and time.';
  }

  const minMs = now.getTime() + SCHEDULE_MIN_LEAD_MINUTES * 60_000;
  const maxMs = getScheduleMaxDateTimeMs(platform, now);
  const maxLabel = getScheduleMaxLeadLabel(platform);

  if (parsedMs < minMs) {
    return `Scheduled time must be at least ${SCHEDULE_MIN_LEAD_MINUTES} minutes in the future.`;
  }
  if (parsedMs > maxMs) {
    return `Scheduled time must be within ${maxLabel} from now.`;
  }

  return undefined;
}

/**
 * Validates a UTC ISO schedule timestamp for YouTube publish/start times.
 * @param iso - UTC ISO 8601 publish/start time.
 * @param now - Reference instant.
 * @returns Error message when invalid, or undefined when valid.
 */
export function validateSchedulePublishAtIso(
  iso: string,
  now: Date = new Date()
): string | undefined {
  return validateSchedulePublishAtIsoForPlatform(iso, 'youtube', now);
}

/**
 * Validates a Unix timestamp (seconds) for Facebook scheduled publish.
 * @param scheduledPublishTime - Unix timestamp in seconds.
 * @param nowMs - Reference time in milliseconds.
 * @returns Error message when invalid, or undefined when valid.
 */
export function validateFacebookScheduledPublishTime(
  scheduledPublishTime: number,
  nowMs: number = Date.now()
): string | undefined {
  if (!Number.isFinite(scheduledPublishTime)) {
    return 'Scheduled publish time must be a valid Unix timestamp.';
  }

  return validateSchedulePublishAtIsoForPlatform(
    new Date(scheduledPublishTime * 1000).toISOString(),
    'facebook',
    new Date(nowMs)
  );
}

/** @deprecated Use {@link SCHEDULE_MIN_LEAD_MINUTES} via seconds in callers. */
export const FACEBOOK_MIN_SCHEDULE_LEAD_SECONDS = SCHEDULE_MIN_LEAD_MINUTES * 60;

/** @deprecated Use {@link FACEBOOK_MAX_SCHEDULE_LEAD_DAYS}. */
export const FACEBOOK_MAX_SCHEDULE_LEAD_SECONDS = FACEBOOK_MAX_SCHEDULE_LEAD_DAYS * 24 * 60 * 60;
