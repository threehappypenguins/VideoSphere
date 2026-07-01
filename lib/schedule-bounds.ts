import { addDays, addMonths, endOfDay, startOfDay } from 'date-fns';

/** Minimum lead time before a scheduled publish/start time. */
export const SCHEDULE_MIN_LEAD_MINUTES = 10;

/** Maximum months in the future YouTube allows scheduling. */
export const YOUTUBE_MAX_SCHEDULE_LEAD_MONTHS = 12;

/** Maximum days in the future Facebook allows scheduling. */
export const FACEBOOK_MAX_SCHEDULE_LEAD_DAYS = 75;

/** Maximum days in the future SermonAudio allows scheduling. */
export const SERMONAUDIO_MAX_SCHEDULE_LEAD_DAYS = 60;

/**
 * Platform whose schedule window applies.
 * @property youtube - Up to {@link YOUTUBE_MAX_SCHEDULE_LEAD_MONTHS} months ahead.
 * @property facebook - Up to {@link FACEBOOK_MAX_SCHEDULE_LEAD_DAYS} days ahead.
 * @property sermon_audio - Up to {@link SERMONAUDIO_MAX_SCHEDULE_LEAD_DAYS} days ahead.
 */
export type SchedulePlatform = 'youtube' | 'facebook' | 'sermon_audio';

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
  if (platform === 'facebook') {
    return startOfDay(addDays(now, FACEBOOK_MAX_SCHEDULE_LEAD_DAYS));
  }
  if (platform === 'sermon_audio') {
    return startOfDay(addDays(now, SERMONAUDIO_MAX_SCHEDULE_LEAD_DAYS));
  }
  return startOfDay(addMonths(now, YOUTUBE_MAX_SCHEDULE_LEAD_MONTHS));
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
  return endOfDay(getScheduleMaxDate(platform, now)).getTime();
}

/**
 * Human-readable description of the latest allowed schedule lead for a platform.
 * @param platform - Target platform (`youtube` or `facebook`).
 * @returns Short phrase for UI help text (e.g. `12 months`, `75 days`).
 */
export function getScheduleMaxLeadLabel(platform: SchedulePlatform): string {
  if (platform === 'facebook') {
    return `${FACEBOOK_MAX_SCHEDULE_LEAD_DAYS} days`;
  }
  if (platform === 'sermon_audio') {
    return `${SERMONAUDIO_MAX_SCHEDULE_LEAD_DAYS} days`;
  }
  return `${YOUTUBE_MAX_SCHEDULE_LEAD_MONTHS} months`;
}

function parseUtcIsoScheduleTimestamp(iso: string): number | null {
  const trimmed = iso.trim();
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(trimmed)) {
    return null;
  }

  const parsedMs = Date.parse(trimmed);
  return Number.isNaN(parsedMs) ? null : parsedMs;
}

function validateSchedulePublishAtIsoForPlatform(
  iso: string,
  platform: SchedulePlatform,
  now: Date = new Date()
): string | undefined {
  const parsedMs = parseUtcIsoScheduleTimestamp(iso);
  if (parsedMs === null) {
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

/**
 * Validates a Unix timestamp (seconds) for SermonAudio scheduled publish.
 * Past times are allowed (SermonAudio publishes immediately). Only the upper bound is enforced.
 * @param publishTimestamp - Unix timestamp in seconds.
 * @param nowMs - Reference time in milliseconds.
 * @returns Error message when invalid, or undefined when valid.
 */
export function validateSermonAudioScheduledPublishTime(
  publishTimestamp: number,
  nowMs: number = Date.now()
): string | undefined {
  if (!Number.isFinite(publishTimestamp)) {
    return 'Scheduled publish time must be a valid Unix timestamp.';
  }

  const parsedMs = Math.floor(publishTimestamp) * 1000;
  const maxMs = getScheduleMaxDateTimeMs('sermon_audio', new Date(nowMs));
  const maxLabel = getScheduleMaxLeadLabel('sermon_audio');

  if (parsedMs > maxMs) {
    return `Scheduled time must be within ${maxLabel} from now.`;
  }

  return undefined;
}

/** @deprecated Use {@link SCHEDULE_MIN_LEAD_MINUTES} via seconds in callers. */
export const FACEBOOK_MIN_SCHEDULE_LEAD_SECONDS = SCHEDULE_MIN_LEAD_MINUTES * 60;

/** @deprecated Use {@link FACEBOOK_MAX_SCHEDULE_LEAD_DAYS}. */
export const FACEBOOK_MAX_SCHEDULE_LEAD_SECONDS = FACEBOOK_MAX_SCHEDULE_LEAD_DAYS * 24 * 60 * 60;
