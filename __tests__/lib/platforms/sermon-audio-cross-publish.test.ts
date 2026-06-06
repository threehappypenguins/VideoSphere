import { describe, expect, it } from 'vitest';
import {
  buildSermonAudioSocialSharingCreateFields,
  normalizeSermonAudioCrossPublishPlatformSettings,
  normalizeSermonAudioCrossPublishSettings,
  SERMON_AUDIO_CROSS_PUBLISH_VIDEO_CLIP_END_SECONDS,
  sermonAudioCrossPublishHasActiveSelection,
} from '@/lib/platforms/sermon-audio-cross-publish';

describe('normalizeSermonAudioCrossPublishSettings', () => {
  it('returns undefined for non-objects', () => {
    expect(normalizeSermonAudioCrossPublishSettings(null)).toBeUndefined();
  });

  it('normalizes master enabled flag and nested platform options', () => {
    expect(
      normalizeSermonAudioCrossPublishSettings({
        enabled: true,
        facebook: {
          postLink: true,
          uploadFullVideo: false,
          linkMessage: '  Watch this sermon  ',
        },
        x: { postLink: true, uploadVideoPreview: true },
      })
    ).toEqual({
      enabled: true,
      facebook: {
        postLink: true,
        uploadFullVideo: false,
        linkMessage: 'Watch this sermon',
      },
      x: { postLink: true, uploadVideoPreview: true },
    });
  });
});

describe('normalizeSermonAudioCrossPublishPlatformSettings', () => {
  it('drops empty strings and invalid booleans', () => {
    expect(
      normalizeSermonAudioCrossPublishPlatformSettings({
        postLink: true,
        linkMessage: '   ',
      })
    ).toEqual({ postLink: true });
  });
});

describe('sermonAudioCrossPublishHasActiveSelection', () => {
  it('returns true when master toggle is on and a platform has options selected', () => {
    expect(
      sermonAudioCrossPublishHasActiveSelection({
        enabled: true,
        facebook: { postLink: true },
      })
    ).toBe(true);
  });

  it('returns false when master toggle is off', () => {
    expect(
      sermonAudioCrossPublishHasActiveSelection({
        enabled: false,
        facebook: { postLink: true },
      })
    ).toBe(false);
  });

  it('returns false when master toggle is on but no platform options are selected', () => {
    expect(
      sermonAudioCrossPublishHasActiveSelection({
        enabled: true,
        facebook: { postLink: false },
      })
    ).toBe(false);
  });

  it('returns true when only X video preview is selected', () => {
    expect(
      sermonAudioCrossPublishHasActiveSelection({
        enabled: true,
        x: { uploadVideoPreview: true },
      })
    ).toBe(true);
  });
});

describe('buildSermonAudioSocialSharingCreateFields', () => {
  it('returns undefined when Cross Publish is disabled', () => {
    expect(
      buildSermonAudioSocialSharingCreateFields({
        enabled: false,
        facebook: { postLink: true },
      })
    ).toBeUndefined();
  });

  it('maps Cross Publish settings to sermon create socialSharing array format', () => {
    expect(
      buildSermonAudioSocialSharingCreateFields(
        {
          enabled: true,
          youtube: { postLink: true, uploadFullVideo: true, linkMessage: 'Watch on YouTube' },
          facebook: { uploadFullVideo: true },
          x: { postLink: true, uploadVideoPreview: true, linkMessage: 'New sermon' },
        },
        { defaultLinkMessage: 'Sunday Sermon' }
      )
    ).toEqual({
      socialSharing: [
        {
          platform: 'google',
          message: 'Watch on YouTube',
          useVideoClip: true,
        },
        {
          platform: 'facebook',
          message: 'Sunday Sermon',
          useVideoClip: true,
        },
        {
          platform: 'twitter',
          message: 'New sermon',
          useVideoClip: true,
        },
      ],
      social_sharing_video_clip: {
        start: 0,
        end: SERMON_AUDIO_CROSS_PUBLISH_VIDEO_CLIP_END_SECONDS,
      },
    });
  });

  it('always includes preview clip range when Cross Publish destinations are selected', () => {
    expect(
      buildSermonAudioSocialSharingCreateFields({
        enabled: true,
        facebook: { postLink: true, linkMessage: 'Listen here' },
      })
    ).toEqual({
      socialSharing: [{ platform: 'facebook', message: 'Listen here', useVideoClip: true }],
      social_sharing_video_clip: {
        start: 0,
        end: SERMON_AUDIO_CROSS_PUBLISH_VIDEO_CLIP_END_SECONDS,
      },
    });
  });
});
