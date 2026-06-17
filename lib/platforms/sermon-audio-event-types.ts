import { SERMON_AUDIO_DEFAULT_LANGUAGE_CODE } from '@/lib/platforms/sermon-audio-languages';

/**
 * Full SermonAudio sermon event type catalog from OpenAPI `SermonEventType` enum.
 * The filter_options API often returns only categories a broadcaster has used; upload
 * accepts any value from this catalog (`SermonParamsCreate.eventType`).
 */
export const SERMON_AUDIO_EVENT_TYPES = [
  'Audiobook',
  'Bible Study',
  'Camp Meeting',
  'Chapel Service',
  'Children',
  'Classic Audio',
  'Conference',
  'Current Events',
  'Debate',
  'Devotional',
  'Funeral Service',
  'Midweek Service',
  'Miscellaneous',
  'Open-Air Ministry',
  'Podcast',
  'Prayer Meeting',
  'Question & Answer',
  'Radio Broadcast',
  'Sermon Clip',
  'Special Meeting',
  'Sunday - AM',
  'Sunday - PM',
  'Sunday School',
  'Sunday Service',
  'Teaching',
  'Testimony',
  'TV Broadcast',
  'Wedding',
  'Youth',
] as const;

/** A valid SermonAudio sermon event type label. */
export type SermonAudioEventType = (typeof SERMON_AUDIO_EVENT_TYPES)[number];

/** Default event category for new SermonAudio uploads (matches OpenAPI `SermonParamsCreate.eventType`). */
export const SERMON_AUDIO_DEFAULT_EVENT_TYPE: SermonAudioEventType = 'Sunday Service';

/**
 * Formats a date as `YYYY-MM-DD` in the user's local timezone.
 * @param date - Date to format. Defaults to now.
 * @returns Local calendar date string suitable for SermonAudio `preachDate`.
 */
export function formatSermonAudioLocalDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns default SermonAudio field values for fields that are not yet set.
 * @param existing - Current SermonAudio draft fields, if any.
 * @returns Patch containing `preachDate` and/or `eventType` defaults.
 */
export function mergeSermonAudioDefaultFields(existing?: {
  preachDate?: string;
  eventType?: string;
  languageCode?: string;
}): { preachDate?: string; eventType?: string; languageCode?: string } {
  const patch: { preachDate?: string; eventType?: string; languageCode?: string } = {};
  if (!existing?.preachDate?.trim()) {
    patch.preachDate = formatSermonAudioLocalDate();
  }
  if (!existing?.eventType?.trim()) {
    patch.eventType = SERMON_AUDIO_DEFAULT_EVENT_TYPE;
  }
  if (!existing?.languageCode?.trim()) {
    patch.languageCode = SERMON_AUDIO_DEFAULT_LANGUAGE_CODE;
  }
  return patch;
}

/**
 * Merges API-fetched event types with the documented global catalog.
 * @param fetched - Labels returned by SermonAudio filter_options (may be broadcaster-scoped).
 * @returns Sorted, deduplicated list of all known event type labels.
 */
export function mergeSermonAudioEventTypes(fetched: readonly string[]): string[] {
  const labels = new Set<string>(SERMON_AUDIO_EVENT_TYPES);
  for (const label of fetched) {
    const trimmed = label.trim();
    if (trimmed !== '') {
      labels.add(trimmed);
    }
  }
  return [...labels].sort((a, b) => a.localeCompare(b));
}
