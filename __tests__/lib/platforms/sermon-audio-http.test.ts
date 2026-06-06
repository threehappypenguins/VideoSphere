import { describe, expect, it } from 'vitest';
import { SERMONAUDIO_API_BASE, resolveSermonAudioApiUrl } from '@/lib/platforms/sermon-audio-http';

describe('resolveSermonAudioApiUrl', () => {
  it('resolves relative API paths against the SermonAudio origin over HTTPS', () => {
    expect(resolveSermonAudioApiUrl('/v2/node/filter_options/sermon_event_types?page=2')).toBe(
      `${SERMONAUDIO_API_BASE}/v2/node/filter_options/sermon_event_types?page=2`
    );
  });

  it('accepts absolute SermonAudio API URLs and forces HTTPS', () => {
    expect(
      resolveSermonAudioApiUrl(
        'http://api.sermonaudio.com/v2/node/filter_options/sermon_event_types?page=2'
      )
    ).toBe(`${SERMONAUDIO_API_BASE}/v2/node/filter_options/sermon_event_types?page=2`);
  });

  it('rejects untrusted absolute URLs', () => {
    expect(resolveSermonAudioApiUrl('https://evil.example/ssrf')).toBeNull();
    expect(resolveSermonAudioApiUrl('http://127.0.0.1/admin')).toBeNull();
  });

  it('returns null for empty or invalid input', () => {
    expect(resolveSermonAudioApiUrl('')).toBeNull();
    expect(resolveSermonAudioApiUrl('   ')).toBeNull();
    expect(resolveSermonAudioApiUrl('not a url')).toBeNull();
  });
});
