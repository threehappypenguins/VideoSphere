import { describe, expect, it } from 'vitest';

import {
  canChangeLivestreamThumbnail,
  canEditLivestreamMetadata,
  canEditLivestreamSchedule,
  rejectLivestreamPatchLockedScheduleFields,
  shouldSyncLivestreamMetadataToYouTube,
} from '@/lib/livestreams/livestream-edit-policy';

describe('livestream edit policy', () => {
  it('allows metadata edits for draft, scheduled, live, ended, and failed statuses', () => {
    expect(canEditLivestreamMetadata('draft')).toBe(true);
    expect(canEditLivestreamMetadata('scheduled')).toBe(true);
    expect(canEditLivestreamMetadata('live')).toBe(true);
    expect(canEditLivestreamMetadata('ended')).toBe(true);
    expect(canEditLivestreamMetadata('failed')).toBe(true);
  });

  it('allows schedule edits only before go-live', () => {
    expect(canEditLivestreamSchedule('draft')).toBe(true);
    expect(canEditLivestreamSchedule('scheduled')).toBe(true);
    expect(canEditLivestreamSchedule('live')).toBe(false);
    expect(canEditLivestreamSchedule('ended')).toBe(false);
    expect(canEditLivestreamSchedule('failed')).toBe(false);
  });

  it('allows thumbnail replacement through ended and failed', () => {
    expect(canChangeLivestreamThumbnail('scheduled')).toBe(true);
    expect(canChangeLivestreamThumbnail('live')).toBe(true);
    expect(canChangeLivestreamThumbnail('ended')).toBe(true);
    expect(canChangeLivestreamThumbnail('failed')).toBe(true);
  });

  it('blocks schedule and target fields in PATCH bodies after go-live', () => {
    expect(rejectLivestreamPatchLockedScheduleFields({ title: 'New title' }, 'live')).toBeNull();
    expect(
      rejectLivestreamPatchLockedScheduleFields(
        { scheduledStartTime: '2026-06-21T03:00:00.000Z' },
        'live'
      )
    ).toMatchObject({ statusCode: 409 });
    expect(
      rejectLivestreamPatchLockedScheduleFields(
        { scheduledStartTime: '2026-06-21T03:00:00.000Z' },
        'ended'
      )
    ).toMatchObject({ statusCode: 409 });
  });

  it('syncs metadata to YouTube for non-draft broadcasts', () => {
    expect(
      shouldSyncLivestreamMetadataToYouTube({
        status: 'scheduled',
        youtubeBroadcastId: 'broadcast-1',
      })
    ).toBe(true);
    expect(
      shouldSyncLivestreamMetadataToYouTube({
        status: 'live',
        youtubeBroadcastId: 'broadcast-1',
      })
    ).toBe(true);
    expect(
      shouldSyncLivestreamMetadataToYouTube({
        status: 'ended',
        youtubeBroadcastId: 'broadcast-1',
      })
    ).toBe(true);
    expect(
      shouldSyncLivestreamMetadataToYouTube({
        status: 'draft',
        youtubeBroadcastId: 'broadcast-1',
      })
    ).toBe(false);
  });
});
