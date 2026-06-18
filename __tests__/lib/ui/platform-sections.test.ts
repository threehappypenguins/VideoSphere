import { describe, it, expect } from 'vitest';
import { groupPlatformsBySection, sortPlatformsAlphabetically } from '@/lib/ui/platform-sections';

describe('sortPlatformsAlphabetically', () => {
  it('sorts platforms by display label', () => {
    expect(sortPlatformsAlphabetically(['youtube', 'facebook', 'vimeo'])).toEqual([
      'facebook',
      'vimeo',
      'youtube',
    ]);
  });
});

describe('groupPlatformsBySection', () => {
  it('splits platforms into alphabetical video and backup sections', () => {
    expect(
      groupPlatformsBySection([
        'youtube',
        'google_drive',
        'facebook',
        'sftp',
        'vimeo',
        'sermon_audio',
        'smb',
      ])
    ).toEqual({
      videoPlatforms: ['facebook', 'sermon_audio', 'vimeo', 'youtube'],
      backupPlatforms: ['google_drive', 'sftp', 'smb'],
    });
  });

  it('omits platforms that are not in either section definition', () => {
    expect(groupPlatformsBySection(['youtube', 'google_drive'])).toEqual({
      videoPlatforms: ['youtube'],
      backupPlatforms: ['google_drive'],
    });
  });
});
