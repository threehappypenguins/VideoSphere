import type { ApiError, Livestream, LivestreamStatus } from '@/types';

/** Statuses where title, description, tags, visibility, platforms, and thumbnail may be edited. */
export const LIVESTREAM_METADATA_EDITABLE_STATUSES = new Set<LivestreamStatus>([
  'draft',
  'scheduled',
  'live',
]);

/** Statuses where schedule time, stream key, and auto-promote settings may be edited. */
export const LIVESTREAM_SCHEDULE_EDITABLE_STATUSES = new Set<LivestreamStatus>([
  'draft',
  'scheduled',
]);

const LIVESTREAM_PATCH_BLOCKED_WHEN_LIVE = [
  'scheduledStartTime',
  'scheduledStartTimeZone',
  'autoPromoteToMainKey',
  'autoPromoteToMainKeyMinutes',
  'targets',
] as const;

/**
 * Returns whether metadata fields may be edited for a livestream status.
 * @param status - Current livestream lifecycle status.
 * @returns True when metadata edits are allowed.
 */
export function canEditLivestreamMetadata(status: LivestreamStatus): boolean {
  return LIVESTREAM_METADATA_EDITABLE_STATUSES.has(status);
}

/**
 * Returns whether schedule and stream-key settings may be edited.
 * @param status - Current livestream lifecycle status.
 * @returns True when schedule edits are allowed.
 */
export function canEditLivestreamSchedule(status: LivestreamStatus): boolean {
  return LIVESTREAM_SCHEDULE_EDITABLE_STATUSES.has(status);
}

/**
 * Returns whether a saved livestream should push metadata changes to YouTube.
 * @param livestream - Livestream row after save.
 * @returns True when a YouTube broadcast sync should run.
 */
export function shouldSyncLivestreamMetadataToYouTube(
  livestream: Pick<Livestream, 'status' | 'youtubeBroadcastId'>
): boolean {
  return (
    (livestream.status === 'scheduled' || livestream.status === 'live') &&
    Boolean(livestream.youtubeBroadcastId?.trim())
  );
}

/**
 * Rejects PATCH body fields that cannot change while a livestream is live.
 * @param body - Parsed PATCH JSON body.
 * @param status - Current livestream lifecycle status.
 * @returns API error when a blocked field is present, otherwise null.
 */
export function rejectLivestreamPatchFieldsWhenLive(
  body: Record<string, unknown>,
  status: LivestreamStatus
): ApiError | null {
  if (status !== 'live') {
    return null;
  }

  for (const field of LIVESTREAM_PATCH_BLOCKED_WHEN_LIVE) {
    if (field in body) {
      return {
        error: 'Conflict',
        message: `${field} cannot be changed while the livestream is live.`,
        statusCode: 409,
      };
    }
  }

  return null;
}
