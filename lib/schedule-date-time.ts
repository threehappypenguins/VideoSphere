import { format, parseISO } from 'date-fns';

/**
 * Parses a wall-clock schedule date string into a local calendar `Date` for pickers.
 * @param dateStr - Calendar date (`YYYY-MM-DD`).
 * @returns Local midnight for that date, or `undefined` when invalid.
 */
export function scheduleDateStrToDate(dateStr: string): Date | undefined {
  const trimmed = dateStr.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return undefined;
  }

  const parsed = parseISO(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed;
}

/**
 * Formats a calendar `Date` as a wall-clock schedule date string.
 * @param date - Selected calendar day.
 * @returns `YYYY-MM-DD` suitable for schedule fields.
 */
export function scheduleDateToDateStr(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * Normalizes a time value to `HH:MM` (24-hour).
 * @param value - Raw schedule time string.
 * @returns Normalized time string, or empty when invalid.
 */
export function normalizeScheduleTimeStr(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    return '';
  }

  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!match) {
    return '';
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return '';
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Formats a schedule time for screen-reader labels when the native control hides 24h values.
 * @param timeStr - Stored schedule time (`HH:MM`).
 * @returns Locale-aware time label.
 */
export function formatScheduleTimeLabel(timeStr: string): string {
  const normalized = normalizeScheduleTimeStr(timeStr);
  if (!normalized) {
    return '';
  }

  const [hour, minute] = normalized.split(':').map(Number);
  const date = new Date(2000, 0, 1, hour, minute, 0);
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/**
 * Whether the current locale prefers 12-hour clock labels.
 * @returns True when hours should be shown with AM/PM.
 */
export function uses12HourClock(): boolean {
  try {
    const { hour12 } = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions();
    if (typeof hour12 === 'boolean') {
      return hour12;
    }
  } catch {
    // Fall through to sample formatting below.
  }

  return /am|pm/i.test(
    new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2020, 0, 1, 13, 0))
  );
}

/**
 * Parsed 24-hour wall-clock parts for schedule pickers.
 * @property hour - Hour in 24-hour form (`0`–`23`).
 * @property minute - Minute (`0`–`59`).
 */
export interface ScheduleTimeParts {
  hour: number;
  minute: number;
}

/**
 * Parses a stored schedule time into hour and minute parts.
 * @param timeStr - Stored schedule time (`HH:MM`).
 * @returns Parsed parts, or null when invalid.
 */
export function parseScheduleTimeParts(timeStr: string): ScheduleTimeParts | null {
  const normalized = normalizeScheduleTimeStr(timeStr);
  if (!normalized) {
    return null;
  }

  const [hour, minute] = normalized.split(':').map(Number);
  return { hour, minute };
}

/**
 * Builds a normalized schedule time string from 24-hour parts.
 * @param hour - Hour (`0`–`23`).
 * @param minute - Minute (`0`–`59`).
 * @returns `HH:MM` time string.
 */
export function buildScheduleTimeStr(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Converts 24-hour time to 12-hour display parts.
 * @param hour24 - Hour in 24-hour form.
 * @returns Hour (`1`–`12`) and meridiem label.
 */
export function to12HourParts(hour24: number): { hour12: number; period: 'AM' | 'PM' } {
  const period: 'AM' | 'PM' = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return { hour12, period };
}

/**
 * Converts 12-hour display parts to a 24-hour hour value.
 * @param hour12 - Hour on a 12-hour clock (`1`–`12`).
 * @param period - Meridiem label.
 * @returns Hour in 24-hour form.
 */
export function to24HourFrom12(hour12: number, period: 'AM' | 'PM'): number {
  if (period === 'AM') {
    return hour12 === 12 ? 0 : hour12;
  }
  return hour12 === 12 ? 12 : hour12 + 12;
}

/** Minute options (`00`–`59`) for scroll pickers. */
export const SCHEDULE_MINUTE_OPTIONS = Array.from({ length: 60 }, (_, minute) => minute);

/**
 * Hour options for scroll pickers in the user's preferred clock format.
 * @param use12Hour - When true, returns `1`–`12`; otherwise `0`–`23`.
 * @returns Hour values for the picker column.
 */
export function getScheduleHourOptions(use12Hour: boolean): number[] {
  if (use12Hour) {
    return Array.from({ length: 12 }, (_, index) => index + 1);
  }
  return Array.from({ length: 24 }, (_, hour) => hour);
}
