import { describe, expect, it } from 'vitest';

import { stripLockedLivestreamPlatformsPatchForStatus } from '@/lib/livestream-upload-metadata';

describe('stripLockedLivestreamPlatformsPatchForStatus', () => {
  it('leaves playlist fields on draft patches', () => {
    const patch = {
      youtube: {
        playlistIds: ['PL123'],
        playlistTitles: ['Services'],
      },
    };

    expect(stripLockedLivestreamPlatformsPatchForStatus(patch, 'draft')).toEqual(patch);
  });

  it('removes playlist fields from scheduled and live patches', () => {
    const patch = {
      youtube: {
        categoryId: '22',
        playlistIds: ['PL123'],
        playlistTitles: ['Services'],
      },
    };

    expect(stripLockedLivestreamPlatformsPatchForStatus(patch, 'scheduled')).toEqual({
      youtube: {
        categoryId: '22',
      },
    });
    expect(stripLockedLivestreamPlatformsPatchForStatus(patch, 'live')).toEqual({
      youtube: {
        categoryId: '22',
      },
    });
  });
});
