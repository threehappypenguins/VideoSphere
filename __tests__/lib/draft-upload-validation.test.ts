import { describe, expect, it } from 'vitest';
import { validateDraftForUpload } from '@/lib/draft-upload-validation';

describe('validateDraftForUpload', () => {
  it('requires a shared title when one metadata platform is selected', () => {
    const issues = validateDraftForUpload({
      title: '  ',
      description: 'Desc',
      tags: [],
      visibility: 'public',
      targets: ['sermon_audio'],
      platforms: {
        sermon_audio: {
          speakerName: 'Rev. Smith',
          preachDate: '2026-06-01',
          eventType: 'Sunday Service',
        },
      },
    });
    expect(issues.some((issue) => issue.field === 'title')).toBe(true);
  });

  it('requires per-platform titles when overrides are enabled', () => {
    const issues = validateDraftForUpload({
      title: 'Shared',
      description: 'Desc',
      tags: [],
      visibility: 'public',
      targets: ['youtube', 'vimeo'],
      platforms: {
        youtube: { titleOverride: 'YouTube title' },
        vimeo: { titleOverride: '' },
      },
    });
    expect(issues).toEqual([
      expect.objectContaining({
        field: 'title:vimeo',
        message: 'Vimeo title is required before upload.',
      }),
    ]);
  });

  it('requires facebook title when per-platform overrides are enabled', () => {
    const issues = validateDraftForUpload({
      title: '',
      description: 'Desc',
      tags: [],
      visibility: 'public',
      targets: ['youtube', 'facebook'],
      platforms: {
        youtube: { titleOverride: 'YouTube title' },
        facebook: { titleOverride: '  ' },
      },
    });
    expect(issues).toEqual([
      expect.objectContaining({
        field: 'title:facebook',
        message: 'Facebook title is required before upload.',
      }),
    ]);
  });

  it('requires SermonAudio speaker, date, and event category on upload', () => {
    const issues = validateDraftForUpload({
      title: 'Sermon',
      description: '',
      tags: [],
      visibility: 'public',
      targets: ['sermon_audio'],
      platforms: { sermon_audio: {} },
    });
    expect(issues.map((issue) => issue.field)).toEqual([
      'sermon_audio.speakerName',
      'sermon_audio.preachDate',
      'sermon_audio.eventType',
    ]);
  });

  it('accepts SermonAudio upload when only speakerID is set', () => {
    const issues = validateDraftForUpload({
      title: 'Sermon',
      description: '',
      tags: [],
      visibility: 'public',
      targets: ['sermon_audio'],
      platforms: {
        sermon_audio: {
          speakerID: 42,
          preachDate: '2026-06-01',
          eventType: 'Sunday Service',
        },
      },
    });
    expect(issues.map((issue) => issue.field)).toEqual([]);
  });

  it('accepts per-platform titleOverride when only one metadata platform is selected', () => {
    const issues = validateDraftForUpload({
      title: '',
      description: 'Desc',
      tags: [],
      visibility: 'public',
      targets: ['sermon_audio'],
      platforms: {
        sermon_audio: {
          titleOverride: 'SA-only title',
          speakerName: 'Rev. Smith',
          preachDate: '2026-06-01',
          eventType: 'Sunday Service',
        },
      },
    });
    expect(issues.map((issue) => issue.field)).toEqual([]);
  });

  it('rejects unlisted shared privacy when Vimeo does not support unlisted', () => {
    const issues = validateDraftForUpload({
      title: 'Title',
      description: 'Desc',
      tags: [],
      targets: ['youtube', 'vimeo'],
      visibility: 'unlisted',
      platforms: {},
      vimeoSupportsUnlistedPrivacy: false,
    });
    expect(issues).toEqual([
      expect.objectContaining({
        field: 'visibility',
        message: expect.stringMatching(/Unlisted is not available on your Vimeo plan/i),
      }),
    ]);
  });

  it('allows unlisted YouTube override when Vimeo does not support unlisted', () => {
    const issues = validateDraftForUpload({
      title: 'Title',
      description: 'Desc',
      tags: [],
      targets: ['youtube', 'vimeo'],
      visibility: 'public',
      platforms: {
        youtube: { visibilityOverride: 'unlisted' },
        vimeo: { visibilityOverride: 'private' },
      },
      vimeoSupportsUnlistedPrivacy: false,
    });
    expect(issues.map((issue) => issue.field)).toEqual([]);
  });
});
