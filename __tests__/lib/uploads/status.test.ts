import { describe, expect, it } from 'vitest';
import {
  isPlatformUploadDistributionComplete,
  isPlatformUploadRowActive,
  isPlatformUploadStatusInProgress,
  isSermonAudioAwaitingAutoPublish,
  SERMONAUDIO_AUTO_PUBLISH_UI_STALE_MS,
} from '@/lib/uploads/status';

describe('isPlatformUploadDistributionComplete', () => {
  it('treats completed, unpublished, and published as distribution-complete', () => {
    expect(isPlatformUploadDistributionComplete('completed')).toBe(true);
    expect(isPlatformUploadDistributionComplete('unpublished')).toBe(true);
    expect(isPlatformUploadDistributionComplete('published')).toBe(true);
  });

  it('treats pending, uploading, and failed as not distribution-complete', () => {
    expect(isPlatformUploadDistributionComplete('pending')).toBe(false);
    expect(isPlatformUploadDistributionComplete('uploading')).toBe(false);
    expect(isPlatformUploadDistributionComplete('failed')).toBe(false);
  });
});

describe('isPlatformUploadStatusInProgress', () => {
  it('treats only pending and uploading as in progress', () => {
    expect(isPlatformUploadStatusInProgress('pending')).toBe(true);
    expect(isPlatformUploadStatusInProgress('uploading')).toBe(true);
  });

  it('treats terminal and SermonAudio post-upload statuses as not in progress', () => {
    expect(isPlatformUploadStatusInProgress('completed')).toBe(false);
    expect(isPlatformUploadStatusInProgress('unpublished')).toBe(false);
    expect(isPlatformUploadStatusInProgress('published')).toBe(false);
    expect(isPlatformUploadStatusInProgress('failed')).toBe(false);
  });
});

describe('isSermonAudioAwaitingAutoPublish', () => {
  it('is true only for unpublished rows when auto-publish is enabled', () => {
    expect(isSermonAudioAwaitingAutoPublish('unpublished', true)).toBe(true);
    expect(isSermonAudioAwaitingAutoPublish('unpublished', false)).toBe(false);
    expect(isSermonAudioAwaitingAutoPublish('published', true)).toBe(false);
  });
});

describe('isPlatformUploadRowActive', () => {
  it('polls SermonAudio unpublished rows only when auto-publish was enabled', () => {
    expect(
      isPlatformUploadRowActive({
        platform: 'sermon_audio',
        status: 'unpublished',
        sermonAudioAutoPublishOnProcessed: true,
      })
    ).toBe(true);
    expect(
      isPlatformUploadRowActive({
        platform: 'sermon_audio',
        status: 'unpublished',
        sermonAudioAutoPublishOnProcessed: false,
      })
    ).toBe(false);
    expect(
      isPlatformUploadRowActive({
        platform: 'sermon_audio',
        status: 'unpublished',
      })
    ).toBe(false);
  });

  it('stops polling SermonAudio auto-publish rows that have not changed within the UI stale window', () => {
    const staleUpdatedAt = new Date(
      Date.now() - SERMONAUDIO_AUTO_PUBLISH_UI_STALE_MS - 60_000
    ).toISOString();

    expect(
      isPlatformUploadRowActive({
        platform: 'sermon_audio',
        status: 'unpublished',
        sermonAudioAutoPublishOnProcessed: true,
        updatedAt: staleUpdatedAt,
      })
    ).toBe(false);
  });

  it('keeps polling recent SermonAudio auto-publish rows', () => {
    const recentUpdatedAt = new Date(Date.now() - 5 * 60_000).toISOString();

    expect(
      isPlatformUploadRowActive({
        platform: 'sermon_audio',
        status: 'unpublished',
        sermonAudioAutoPublishOnProcessed: true,
        updatedAt: recentUpdatedAt,
      })
    ).toBe(true);
  });
});
