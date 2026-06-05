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
 * Returns default SermonAudio field values for fields that are not yet set.
 * @param existing - Current SermonAudio draft fields, if any.
 * @returns Patch containing `preachDate` and/or `eventType` defaults.
 */
export function mergeSermonAudioDefaultFields(existing?: {
  preachDate?: string;
  eventType?: string;
}): { preachDate?: string; eventType?: string } {
  const patch: { preachDate?: string; eventType?: string } = {};
  if (!existing?.preachDate?.trim()) {
    patch.preachDate = new Date().toISOString().slice(0, 10);
  }
  if (!existing?.eventType?.trim()) {
    patch.eventType = SERMON_AUDIO_DEFAULT_EVENT_TYPE;
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
