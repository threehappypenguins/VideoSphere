export { validateSermonAudioScheduledPublishTime } from '@/lib/schedule-bounds';

import { utcIsoToZonedScheduleParts } from '@/lib/youtube-schedule';

/**
 * Parses a stored SermonAudio `publishTimestamp` into schedule picker parts.
 * @param publishTimestamp - Unix timestamp in seconds.
 * @param timeZone - IANA timezone used to display wall-clock values.
 * @returns Date and time strings for the picker, or null when invalid.
 */
export function sermonAudioPublishTimestampToScheduleParts(
  publishTimestamp: number,
  timeZone: string
): { dateStr: string; timeStr: string } | null {
  if (!Number.isFinite(publishTimestamp)) return null;
  const utcIso = new Date(Math.floor(publishTimestamp) * 1000).toISOString();
  return utcIsoToZonedScheduleParts(utcIso, timeZone);
}
