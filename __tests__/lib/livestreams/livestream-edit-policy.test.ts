import { describe, expect, it } from 'vitest';

import {
  canEditLivestreamMetadata,
  canEditLivestreamSchedule,
  rejectLivestreamPatchFieldsWhenLive,
  shouldSyncLivestreamMetadataToYouTube,
} from '@/lib/livestreams/livestream-edit-policy';

describe('livestream edit policy', () => {
  it('allows metadata edits for draft, scheduled, and live statuses', () => {
    expect(canEditLivestreamMetadata('draft')).toBe(true);
    expect(canEditLivestreamMetadata('scheduled')).toBe(true);
    expect(canEditLivestreamMetadata('live')).toBe(true);
    expect(canEditLivestreamMetadata('ended')).toBe(false);
  });

  it('allows schedule edits only before go-live', () => {
    expect(canEditLivestreamSchedule('draft')).toBe(true);
    expect(canEditLivestreamSchedule('scheduled')).toBe(true);
    expect(canEditLivestreamSchedule('live')).toBe(false);
  });

  it('blocks schedule and target fields in PATCH bodies while live', () => {
    expect(rejectLivestreamPatchFieldsWhenLive({ title: 'New title' }, 'live')).toBeNull();
    expect(
      rejectLivestreamPatchFieldsWhenLive(
        { scheduledStartTime: '2026-06-21T03:00:00.000Z' },
        'live'
      )
    ).toMatchObject({ statusCode: 409 });
  });

  it('syncs metadata to YouTube for scheduled and live broadcasts', () => {
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
        status: 'draft',
        youtubeBroadcastId: 'broadcast-1',
      })
    ).toBe(false);
  });
});
