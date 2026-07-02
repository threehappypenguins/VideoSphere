import { describe, expect, it } from 'vitest';
import {
  buildSermonAudioSocialSharingSettings,
  normalizeSermonAudioCrossPublishPlatformSettings,
  normalizeSermonAudioCrossPublishSettings,
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

  it('drops Facebook uploadFullVideo when postLink is not enabled', () => {
    expect(
      normalizeSermonAudioCrossPublishPlatformSettings('facebook', {
        uploadFullVideo: true,
      })
    ).toBeUndefined();

    expect(
      normalizeSermonAudioCrossPublishPlatformSettings('facebook', {
        postLink: false,
        uploadFullVideo: true,
      })
    ).toEqual({ postLink: false });
  });

  it('drops X uploadVideoPreview when postLink is not enabled', () => {
    expect(
      normalizeSermonAudioCrossPublishPlatformSettings('x', {
        uploadVideoPreview: true,
      })
    ).toBeUndefined();

    expect(
      normalizeSermonAudioCrossPublishPlatformSettings('x', {
        postLink: false,
        uploadVideoPreview: true,
      })
    ).toEqual({ postLink: false });
  });

  it('drops Instagram uploadVideoPreview when postLink is not enabled', () => {
    expect(
      normalizeSermonAudioCrossPublishPlatformSettings('instagram', {
        uploadVideoPreview: true,
      })
    ).toBeUndefined();

    expect(
      normalizeSermonAudioCrossPublishPlatformSettings('instagram', {
        postLink: false,
        uploadVideoPreview: true,
      })
    ).toEqual({ postLink: false });
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

  it('returns false when only Facebook uploadFullVideo is selected without postLink', () => {
    expect(
      sermonAudioCrossPublishHasActiveSelection({
        enabled: true,
        facebook: { uploadFullVideo: true },
      })
    ).toBe(false);
  });

  it('returns false when only X uploadVideoPreview is selected without postLink', () => {
    expect(
      sermonAudioCrossPublishHasActiveSelection({
        enabled: true,
        x: { uploadVideoPreview: true },
      })
    ).toBe(false);
  });

  it('returns false when only Instagram uploadVideoPreview is selected without postLink', () => {
    expect(
      sermonAudioCrossPublishHasActiveSelection({
        enabled: true,
        instagram: { uploadVideoPreview: true },
      })
    ).toBe(false);
  });
});

describe('buildSermonAudioSocialSharingSettings', () => {
  it('returns undefined when Cross Publish is disabled', () => {
    expect(
      buildSermonAudioSocialSharingSettings({
        enabled: false,
        facebook: { postLink: true },
      })
    ).toBeUndefined();
  });

  it('maps platform-specific Cross Publish settings to socialSharingSettings format', () => {
    expect(
      buildSermonAudioSocialSharingSettings(
        {
          enabled: true,
          youtube: {
            uploadFullVideo: true,
            privacy: 'unlisted',
            title: 'YouTube Title',
            description: 'YouTube Description',
          },
          facebook: { postLink: true, uploadFullVideo: true },
          x: { postLink: true, uploadVideoPreview: true, linkMessage: 'New sermon' },
        },
        { defaultTitle: 'Sunday Sermon', defaultDescription: 'Shared description' }
      )
    ).toEqual({
      platforms: [
        {
          platform: 'google',
          title: 'YouTube Title',
          message: 'YouTube Description',
          privacy: 'unlisted',
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
      google: true,
      facebook: true,
      twitter: true,
    });
  });

  it('uses draft defaults for YouTube title and description when fields are empty', () => {
    expect(
      buildSermonAudioSocialSharingSettings(
        {
          enabled: true,
          youtube: { uploadFullVideo: true },
        },
        { defaultTitle: 'Sunday Sermon', defaultDescription: 'Shared description' }
      )
    ).toEqual({
      platforms: [
        {
          platform: 'google',
          title: 'Sunday Sermon',
          message: 'Shared description',
          privacy: 'public',
        },
      ],
      google: true,
    });
  });

  it('falls back to sermon title for YouTube message when description defaults are empty', () => {
    expect(
      buildSermonAudioSocialSharingSettings(
        {
          enabled: true,
          youtube: { uploadFullVideo: true },
        },
        { defaultTitle: 'Sunday Sermon', defaultDescription: '' }
      )
    ).toEqual({
      platforms: [
        {
          platform: 'google',
          title: 'Sunday Sermon',
          message: 'Sunday Sermon',
          privacy: 'public',
        },
      ],
      google: true,
    });
  });

  it('sets useVideoClip false for Facebook link posts', () => {
    expect(
      buildSermonAudioSocialSharingSettings({
        enabled: true,
        facebook: { postLink: true, linkMessage: 'Listen here' },
      })
    ).toEqual({
      platforms: [{ platform: 'facebook', message: 'Listen here', useVideoClip: false }],
      facebook: true,
    });
  });

  it('sets useVideoClip true for Facebook link plus video posts', () => {
    expect(
      buildSermonAudioSocialSharingSettings(
        {
          enabled: true,
          facebook: { postLink: true, uploadFullVideo: true, linkMessage: 'Watch now' },
        },
        { defaultTitle: 'Sunday Sermon', defaultDescription: 'Shared description' }
      )
    ).toEqual({
      platforms: [{ platform: 'facebook', message: 'Watch now', useVideoClip: true }],
      facebook: true,
    });
  });

  it('ignores Facebook uploadFullVideo without postLink', () => {
    expect(
      buildSermonAudioSocialSharingSettings({
        enabled: true,
        facebook: { uploadFullVideo: true },
      })
    ).toBeUndefined();
  });

  it('sets useVideoClip only for X link plus video preview', () => {
    expect(
      buildSermonAudioSocialSharingSettings(
        {
          enabled: true,
          x: { postLink: true, uploadVideoPreview: true, linkMessage: 'Preview clip' },
        },
        { defaultTitle: 'Sunday Sermon' }
      )
    ).toEqual({
      platforms: [{ platform: 'twitter', message: 'Preview clip', useVideoClip: true }],
      twitter: true,
    });
  });

  it('sets useVideoClip false for X link-only posts', () => {
    expect(
      buildSermonAudioSocialSharingSettings({
        enabled: true,
        x: { postLink: true, linkMessage: 'Read more' },
      })
    ).toEqual({
      platforms: [{ platform: 'twitter', message: 'Read more', useVideoClip: false }],
      twitter: true,
    });
  });

  it('ignores X uploadVideoPreview without postLink', () => {
    expect(
      buildSermonAudioSocialSharingSettings({
        enabled: true,
        x: { uploadVideoPreview: true },
      })
    ).toBeUndefined();
  });

  it('sets useVideoClip only for Instagram link plus video preview', () => {
    expect(
      buildSermonAudioSocialSharingSettings(
        {
          enabled: true,
          instagram: { postLink: true, uploadVideoPreview: true, linkMessage: 'Preview clip' },
        },
        { defaultTitle: 'Sunday Sermon' }
      )
    ).toEqual({
      platforms: [{ platform: 'instagram', message: 'Preview clip', useVideoClip: true }],
      instagram: true,
    });
  });

  it('sets useVideoClip false for Instagram link-only posts', () => {
    expect(
      buildSermonAudioSocialSharingSettings({
        enabled: true,
        instagram: { postLink: true, linkMessage: 'Read more' },
      })
    ).toEqual({
      platforms: [{ platform: 'instagram', message: 'Read more', useVideoClip: false }],
      instagram: true,
    });
  });

  it('ignores Instagram uploadVideoPreview without postLink', () => {
    expect(
      buildSermonAudioSocialSharingSettings({
        enabled: true,
        instagram: { uploadVideoPreview: true },
      })
    ).toBeUndefined();
  });
});
