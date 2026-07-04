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

  it('returns a friendly message for HTTP 403 download blocks', () => {
    const stderr = 'ERROR: unable to download video data: HTTP Error 403: Forbidden';

    expect(getUserFriendlyYtDlpErrorMessage(stderr)).toBe(
      'YouTube blocked the video download (HTTP 403). Retry the import; if it keeps failing, update yt-dlp on the server or contact support.'
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
