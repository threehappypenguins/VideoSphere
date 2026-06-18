import { utcIsoToZonedScheduleParts, zonedDateTimeToUtcIso } from '@/lib/youtube-schedule';

/**
 * Parses a SermonAudio `GMT` offset label from `Intl` into an ISO 8601 offset (`±HH:MM`).
 * @param raw - Value from `timeZoneName: 'longOffset'` (for example `GMT-04:00`).
 * @returns Offset suffix such as `-04:00`.
 */
function parseLongOffsetToIsoOffset(raw: string): string {
  if (raw === 'GMT' || raw === 'UTC') return '+00:00';
  if (!raw.startsWith('GMT')) return '+00:00';

  const body = raw.slice(3);
  if (/^[+-]\d{2}:\d{2}$/.test(body)) return body;
  if (/^[+-]\d{1}:\d{2}$/.test(body)) return `${body[0]}0${body.slice(1)}`;
  if (/^[+-]\d{2}$/.test(body)) return `${body}:00`;
  if (/^[+-]\d{1}$/.test(body)) return `${body[0]}0${body[1]}:00`;
  return '+00:00';
}

/**
 * Returns the ISO 8601 offset for an instant in an IANA timezone.
 * @param utcIso - UTC ISO 8601 timestamp.
 * @param timeZone - IANA timezone name.
 * @returns Offset suffix such as `-04:00`.
 */
export function formatTimeZoneOffsetForInstant(utcIso: string, timeZone: string): string {
  const date = new Date(utcIso);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  });
  const raw =
    formatter.formatToParts(date).find((part) => part.type === 'timeZoneName')?.value ?? '';
  return parseLongOffsetToIsoOffset(raw);
}

/**
 * Formats wall-clock date/time in an IANA timezone as SermonAudio `publishDate`.
 * Includes a timezone offset for scheduling precision.
 * @param dateStr - Calendar date (`YYYY-MM-DD`).
 * @param timeStr - Clock time (`HH:MM`).
 * @param timeZone - IANA timezone name.
 * @returns SermonAudio publish datetime (for example `2026-07-01T09:00:00-04:00`).
 * @throws When the wall-clock date/time does not exist in `timeZone`.
 */
export function formatSermonAudioPublishDate(
  dateStr: string,
  timeStr: string,
  timeZone: string
): string {
  const utcIso = zonedDateTimeToUtcIso(dateStr, timeStr, timeZone);
  const offset = formatTimeZoneOffsetForInstant(utcIso, timeZone);
  return `${dateStr}T${timeStr}:00${offset}`;
}

/**
 * Parses a stored SermonAudio `publishDate` into a UTC ISO string for schedule pickers.
 * @param publishDate - SermonAudio publish datetime string.
 * @returns UTC ISO 8601 timestamp, or null when invalid.
 */
export function sermonAudioPublishDateToUtcIso(publishDate: string): string | null {
  const trimmed = publishDate.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

/**
 * Parses a stored SermonAudio `publishDate` into schedule picker parts.
 * @param publishDate - SermonAudio publish datetime string.
 * @param timeZone - IANA timezone used to display wall-clock values.
 * @returns Date and time strings for the picker, or null when invalid.
 */
export function sermonAudioPublishDateToScheduleParts(
  publishDate: string,
  timeZone: string
): { dateStr: string; timeStr: string } | null {
  const utcIso = sermonAudioPublishDateToUtcIso(publishDate);
  if (!utcIso) return null;
  return utcIsoToZonedScheduleParts(utcIso, timeZone);
}
