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
        youtube: { uploadFullVideo: true, privacy: 'unlisted' },
        facebook: {
          postLink: true,
          uploadFullVideo: false,
          linkMessage: '  Watch this sermon  ',
        },
        x: { postLink: true, uploadVideoPreview: true },
      })
    ).toEqual({
      enabled: true,
      youtube: { uploadFullVideo: true, privacy: 'unlisted' },
      facebook: {
        postLink: true,
        uploadFullVideo: false,
        linkMessage: 'Watch this sermon',
      },
      x: { postLink: true, uploadVideoPreview: true },
    });
  });

  it('drops platform fields that are not offered for each destination', () => {
    expect(
      normalizeSermonAudioCrossPublishSettings({
        enabled: true,
        youtube: { postLink: true, linkMessage: 'Stale' },
        facebook: { uploadVideoPreview: true },
      })
    ).toEqual({ enabled: true });
  });
});

describe('normalizeSermonAudioCrossPublishPlatformSettings', () => {
  it('drops empty strings and invalid booleans for Facebook', () => {
    expect(
      normalizeSermonAudioCrossPublishPlatformSettings('facebook', {
        postLink: true,
        linkMessage: '   ',
      })
    ).toEqual({ postLink: true });
  });

  it('normalizes YouTube privacy values when full video upload is enabled', () => {
    expect(
      normalizeSermonAudioCrossPublishPlatformSettings('youtube', {
        uploadFullVideo: true,
        privacy: 'Private',
        title: '  My Sermon  ',
        description: '  Watch online  ',
      })
    ).toEqual({
      uploadFullVideo: true,
      privacy: 'private',
      title: 'My Sermon',
      description: 'Watch online',
    });
  });

  it('drops YouTube title and description when full video upload is off', () => {
    expect(
      normalizeSermonAudioCrossPublishPlatformSettings('youtube', {
        uploadFullVideo: false,
        title: 'Ignored',
        description: 'Ignored',
      })
    ).toEqual({ uploadFullVideo: false });
  });

  it('drops fields that are not offered for the destination', () => {
    expect(
      normalizeSermonAudioCrossPublishPlatformSettings('youtube', {
        postLink: true,
        linkMessage: 'Old link option',
        uploadVideoPreview: true,
      })
    ).toBeUndefined();

    expect(
      normalizeSermonAudioCrossPublishPlatformSettings('facebook', {
        uploadVideoPreview: true,
        privacy: 'public',
      })
    ).toBeUndefined();
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

  it('returns true when only YouTube full video upload is selected', () => {
    expect(
      sermonAudioCrossPublishHasActiveSelection({
        enabled: true,
        youtube: { uploadFullVideo: true },
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

  it('maps platform-specific Cross Publish settings to socialSharing array format', () => {
    expect(
      buildSermonAudioSocialSharingCreateFields(
        {
          enabled: true,
          youtube: {
            uploadFullVideo: true,
            privacy: 'unlisted',
            title: 'YouTube Title',
            description: 'YouTube Description',
          },
          facebook: { uploadFullVideo: true },
          x: { postLink: true, uploadVideoPreview: true, linkMessage: 'New sermon' },
        },
        { defaultTitle: 'Sunday Sermon', defaultDescription: 'Shared description' }
      )
    ).toEqual({
      socialSharing: [
        {
          platform: 'google',
          title: 'YouTube Title',
          message: 'YouTube Description',
          privacy: 'unlisted',
        },
        {
          platform: 'facebook',
          message: 'Shared description',
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

  it('uses draft defaults for YouTube title and description when fields are empty', () => {
    expect(
      buildSermonAudioSocialSharingCreateFields(
        {
          enabled: true,
          youtube: { uploadFullVideo: true },
        },
        { defaultTitle: 'Sunday Sermon', defaultDescription: 'Shared description' }
      )
    ).toEqual({
      socialSharing: [
        {
          platform: 'google',
          title: 'Sunday Sermon',
          message: 'Shared description',
          privacy: 'public',
        },
      ],
    });
  });

  it('falls back to sermon title for YouTube message when description defaults are empty', () => {
    expect(
      buildSermonAudioSocialSharingCreateFields(
        {
          enabled: true,
          youtube: { uploadFullVideo: true },
        },
        { defaultTitle: 'Sunday Sermon', defaultDescription: '' }
      )
    ).toEqual({
      socialSharing: [
        {
          platform: 'google',
          title: 'Sunday Sermon',
          message: 'Sunday Sermon',
          privacy: 'public',
        },
      ],
    });
  });

  it('omits useVideoClip and clip range for link-only Facebook posts', () => {
    expect(
      buildSermonAudioSocialSharingCreateFields({
        enabled: true,
        facebook: { postLink: true, linkMessage: 'Listen here' },
      })
    ).toEqual({
      socialSharing: [{ platform: 'facebook', message: 'Listen here' }],
    });
  });

  it('uses sermon description for Facebook full-video-only posts', () => {
    expect(
      buildSermonAudioSocialSharingCreateFields(
        {
          enabled: true,
          facebook: { uploadFullVideo: true },
        },
        { defaultTitle: 'Sunday Sermon', defaultDescription: 'Shared description' }
      )
    ).toEqual({
      socialSharing: [{ platform: 'facebook', message: 'Shared description' }],
    });
  });

  it('prefers link message over description when Facebook post link is enabled', () => {
    expect(
      buildSermonAudioSocialSharingCreateFields(
        {
          enabled: true,
          facebook: { postLink: true, uploadFullVideo: true, linkMessage: 'Watch now' },
        },
        { defaultTitle: 'Sunday Sermon', defaultDescription: 'Shared description' }
      )
    ).toEqual({
      socialSharing: [{ platform: 'facebook', message: 'Watch now' }],
    });
  });

  it('sets useVideoClip only for X video preview', () => {
    expect(
      buildSermonAudioSocialSharingCreateFields(
        {
          enabled: true,
          x: { postLink: true, uploadVideoPreview: true, linkMessage: 'Preview clip' },
        },
        { defaultTitle: 'Sunday Sermon' }
      )
    ).toEqual({
      socialSharing: [{ platform: 'twitter', message: 'Preview clip', useVideoClip: true }],
      social_sharing_video_clip: {
        start: 0,
        end: SERMON_AUDIO_CROSS_PUBLISH_VIDEO_CLIP_END_SECONDS,
      },
    });
  });

  it('omits useVideoClip for X link-only posts', () => {
    expect(
      buildSermonAudioSocialSharingCreateFields({
        enabled: true,
        x: { postLink: true, linkMessage: 'Read more' },
      })
    ).toEqual({
      socialSharing: [{ platform: 'twitter', message: 'Read more' }],
    });
  });
});
