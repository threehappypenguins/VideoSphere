import { format } from 'date-fns';

/** Options shared by schedule time labels. */
const SCHEDULE_TIME_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: 'numeric',
  minute: '2-digit',
};

/**
 * Formats a schedule time for screen-reader labels when the native control hides 24h values.
 * @param timeStr - Stored schedule time (`HH:MM`).
 * @param options - Display options.
 * @param options.hour12 - When true, formats with AM/PM; otherwise 24-hour.
 * @returns Locale-aware time label.
 */
export function formatScheduleTimeLabel(timeStr: string, options?: { hour12?: boolean }): string {
  const normalized = normalizeScheduleTimeStr(timeStr);
  if (!normalized) {
    return '';
  }

  const [hour, minute] = normalized.split(':').map(Number);
  const date = new Date(2000, 0, 1, hour, minute, 0);
  return new Intl.DateTimeFormat(undefined, {
    ...SCHEDULE_TIME_FORMAT_OPTIONS,
    hour12: options?.hour12 ?? true,
  }).format(date);
}

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

  const [year, month, day] = trimmed.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return undefined;
  }

  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return undefined;
  }

  return date;
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

/**
 * Parses a non-negative integer digit string.
 * @param value - Raw input from a schedule picker field.
 * @returns Parsed integer, or null when empty or not digits-only.
 */
function parseScheduleIntegerInput(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '' || !/^\d+$/.test(trimmed)) {
    return null;
  }

  return parseInt(trimmed, 10);
}

/**
 * Parses and clamps a typed hour for schedule picker columns.
 * @param value - Raw digits from the hour input.
 * @param use12Hour - When true, accepts `1`–`12`; otherwise `0`–`23`.
 * @returns Clamped hour, or null when empty or non-numeric.
 */
export function parseScheduleHourInput(value: string, use12Hour: boolean): number | null {
  const num = parseScheduleIntegerInput(value);
  if (num === null) {
    return null;
  }

  const min = use12Hour ? 1 : 0;
  const max = use12Hour ? 12 : 23;
  return Math.min(max, Math.max(min, num));
}

/**
 * Parses and clamps a typed minute for schedule picker columns.
 * @param value - Raw digits from the minute input.
 * @returns Clamped minute (`0`–`59`), or null when empty or non-numeric.
 */
export function parseScheduleMinuteInput(value: string): number | null {
  const num = parseScheduleIntegerInput(value);
  if (num === null) {
    return null;
  }

  return Math.min(59, Math.max(0, num));
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
