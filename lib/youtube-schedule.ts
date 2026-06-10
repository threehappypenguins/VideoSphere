/** Half-hour time slots from 00:00 through 23:30 for YouTube schedule pickers. */
export const YOUTUBE_SCHEDULE_TIME_OPTIONS: readonly string[] = Array.from(
  { length: 48 },
  (_, index) => {
    const hours = Math.floor(index / 2);
    const minutes = (index % 2) * 30;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
);

/**
 * Returns the browser's resolved IANA timezone name.
 * @returns IANA timezone identifier (e.g. `America/Halifax`), or `UTC` when unavailable.
 */
export function getLocalTimeZone(): string {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone?.trim();
    return timeZone ? timeZone : 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Minimal timezone list when {@link Intl.supportedValuesOf} is unavailable.
 * @returns Local timezone and `UTC`, deduped and sorted.
 */
function getSupportedTimeZonesFallback(): string[] {
  const zones = new Set<string>([getLocalTimeZone(), 'UTC']);
  return [...zones].sort((left, right) => left.localeCompare(right));
}

/**
 * Formats a calendar date as `YYYY-MM-DD` in the given IANA timezone.
 * @param date - Reference instant.
 * @param timeZone - IANA timezone name.
 * @returns Date string suitable for `<input type="date">`.
 */
export function formatDateInTimeZone(date: Date, timeZone: string): string {
  return date.toLocaleDateString('en-CA', { timeZone });
}

/**
 * Default schedule date: today in the given timezone.
 * @param timeZone - IANA timezone name.
 * @param now - Reference instant (defaults to current time).
 * @returns `YYYY-MM-DD` date string.
 */
export function getDefaultScheduleDate(timeZone: string, now: Date = new Date()): string {
  return formatDateInTimeZone(now, timeZone);
}

/**
 * Default schedule time: the next whole hour in the local timezone, clamped to the same day (max 23:30).
 * @param now - Reference instant (defaults to current time).
 * @returns `HH:MM` time string aligned to a 30-minute slot.
 */
export function getDefaultScheduleTime(now: Date = new Date()): string {
  const totalMinutes = now.getHours() * 60 + now.getMinutes();
  const nextHourMinutes = Math.ceil(totalMinutes / 60) * 60;
  const clampedMinutes = Math.min(nextHourMinutes, 23 * 60 + 30);
  const hours = Math.floor(clampedMinutes / 60);
  const minutes = clampedMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Converts a wall-clock date and time in an IANA timezone to a UTC ISO 8601 string.
 * @param dateStr - Calendar date (`YYYY-MM-DD`).
 * @param timeStr - Clock time (`HH:MM`).
 * @param timeZone - IANA timezone name.
 * @returns UTC ISO 8601 timestamp.
 */
export function zonedDateTimeToUtcIso(dateStr: string, timeStr: string, timeZone: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    throw new Error('Invalid YouTube schedule date or time');
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });

  const readWallClock = (utcMs: number) => {
    const parts = formatter.formatToParts(new Date(utcMs));
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value ?? Number.NaN);
    let wallHour = get('hour');
    if (wallHour === 24) wallHour = 0;
    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: wallHour,
      minute: get('minute'),
    };
  };

  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0);

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const wall = readWallClock(utcMs);
    if (
      wall.year === year &&
      wall.month === month &&
      wall.day === day &&
      wall.hour === hour &&
      wall.minute === minute
    ) {
      return new Date(utcMs).toISOString();
    }

    const wallTotalMinutes = wall.hour * 60 + wall.minute;
    const targetTotalMinutes = hour * 60 + minute;
    const minuteDelta =
      (year - wall.year) * 525_600 +
      (month - wall.month) * 43_200 +
      (day - wall.day) * 1_440 +
      (targetTotalMinutes - wallTotalMinutes);
    utcMs += minuteDelta * 60 * 1000;
  }

  return new Date(utcMs).toISOString();
}

/**
 * Parses a UTC ISO timestamp into date and time parts for a target IANA timezone.
 * @param iso - UTC ISO 8601 string.
 * @param timeZone - IANA timezone name.
 * @returns Wall-clock date and time strings, or null when `iso` is invalid.
 */
export function utcIsoToZonedScheduleParts(
  iso: string,
  timeZone: string
): { dateStr: string; timeStr: string } | null {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(parsed));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  let hours = get('hour');
  if (hours === '24') hours = '00';

  return {
    dateStr: `${get('year')}-${get('month')}-${get('day')}`,
    timeStr: `${hours}:${get('minute')}`,
  };
}

/**
 * Returns whether a scheduled publish time is strictly before the current instant.
 * @param publishAt - UTC ISO 8601 string.
 * @param now - Reference instant (defaults to current time).
 * @returns True when the scheduled time is in the past.
 */
export function isPublishAtInPast(publishAt: string, now: Date = new Date()): boolean {
  const parsed = Date.parse(publishAt);
  if (Number.isNaN(parsed)) return false;
  return parsed < now.getTime();
}

/**
 * Returns all IANA timezone names supported by the current runtime.
 * Falls back to the local timezone and `UTC` when `Intl.supportedValuesOf` is unavailable.
 * @returns Sorted timezone identifiers.
 */
export function getSupportedTimeZones(): string[] {
  const supportedValuesOf = (
    Intl as typeof Intl & { supportedValuesOf?: (key: string) => Iterable<string> }
  ).supportedValuesOf;

  if (typeof supportedValuesOf !== 'function') {
    return getSupportedTimeZonesFallback();
  }

  try {
    return [...supportedValuesOf('timeZone')].sort((left, right) => left.localeCompare(right));
  } catch {
    return getSupportedTimeZonesFallback();
  }
}
