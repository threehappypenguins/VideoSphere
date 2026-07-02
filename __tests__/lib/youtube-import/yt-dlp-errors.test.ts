import { describe, expect, it } from 'vitest';
import {
  buildYtDlpProcessError,
  getUserFriendlyYtDlpErrorMessage,
} from '@/lib/youtube-import/yt-dlp-errors';

describe('getUserFriendlyYtDlpErrorMessage', () => {
  it('returns a friendly message for private videos', () => {
    const stderr =
      "ERROR: [youtube] h3DhnqpppU8: Private video. Sign in if you've been granted access to this video.";

    expect(getUserFriendlyYtDlpErrorMessage(stderr)).toBe(
      'This video is private. Make it public or unlisted on YouTube before importing.'
    );
  });

  it('returns null for unrecognized stderr', () => {
    expect(getUserFriendlyYtDlpErrorMessage('Video unavailable')).toBeNull();
  });
});

describe('buildYtDlpProcessError', () => {
  it('prefers a friendly message over raw yt-dlp stderr', () => {
    const error = buildYtDlpProcessError('yt-dlp metadata lookup', 1, [
      Buffer.from('ERROR: [youtube] abc: Private video.'),
    ]);

    expect(error.message).toBe(
      'This video is private. Make it public or unlisted on YouTube before importing.'
    );
  });

  it('falls back to the technical message for other failures', () => {
    const error = buildYtDlpProcessError('yt-dlp metadata lookup', 1, [
      Buffer.from('Video unavailable'),
    ]);

    expect(error.message).toBe('yt-dlp metadata lookup failed (exit 1): Video unavailable');
  });
});
