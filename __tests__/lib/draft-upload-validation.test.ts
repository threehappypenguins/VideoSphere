import { describe, expect, it } from 'vitest';
import { validateDraftForUpload } from '@/lib/draft-upload-validation';

describe('validateDraftForUpload', () => {
  it('requires a shared title when one metadata platform is selected', () => {
    const issues = validateDraftForUpload({
      title: '  ',
      description: 'Desc',
      tags: [],
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

  it('requires SermonAudio speaker, date, and event category on upload', () => {
    const issues = validateDraftForUpload({
      title: 'Sermon',
      description: '',
      tags: [],
      targets: ['sermon_audio'],
      platforms: { sermon_audio: {} },
    });
    expect(issues.map((issue) => issue.field)).toEqual([
      'sermon_audio.speakerName',
      'sermon_audio.preachDate',
      'sermon_audio.eventType',
    ]);
  });
});
