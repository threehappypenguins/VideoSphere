import { describe, expect, it } from 'vitest';
import {
  SERMONAUDIO_API_BASE,
  assertSermonAudioHttpOk,
  isSermonAudioCredentialsFailure,
  resolveSermonAudioApiUrl,
  resolveSermonAudioUploadUrl,
  sermonAudioUpstreamResponseStatus,
} from '@/lib/platforms/sermon-audio-http';

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
    expect(
      resolveSermonAudioApiUrl(
        'https://api.sermonaudio.com:443/v2/node/filter_options/sermon_event_types?page=2'
      )
    ).toBe(`${SERMONAUDIO_API_BASE}/v2/node/filter_options/sermon_event_types?page=2`);
  });

  it('rejects untrusted absolute URLs', () => {
    expect(resolveSermonAudioApiUrl('https://evil.example/ssrf')).toBeNull();
    expect(resolveSermonAudioApiUrl('http://127.0.0.1/admin')).toBeNull();
    expect(
      resolveSermonAudioApiUrl(
        'https://api.sermonaudio.com:8443/v2/node/filter_options/sermon_event_types'
      )
    ).toBeNull();
  });

  it('returns null for empty or invalid input', () => {
    expect(resolveSermonAudioApiUrl('')).toBeNull();
    expect(resolveSermonAudioApiUrl('   ')).toBeNull();
    expect(resolveSermonAudioApiUrl('not a url')).toBeNull();
  });
});

describe('resolveSermonAudioUploadUrl', () => {
  it('accepts absolute HTTPS upload URLs on the SermonAudio domain', () => {
    expect(resolveSermonAudioUploadUrl('https://upload.sermonaudio.com/video')).toBe(
      'https://upload.sermonaudio.com/video'
    );
    expect(resolveSermonAudioUploadUrl('https://upload.sermonaudio.com:443/video')).toBe(
      'https://upload.sermonaudio.com/video'
    );
  });

  it('rejects non-HTTPS or untrusted upload URLs', () => {
    expect(resolveSermonAudioUploadUrl('http://upload.sermonaudio.com/video')).toBeNull();
    expect(resolveSermonAudioUploadUrl('https://evil.example/ssrf')).toBeNull();
    expect(resolveSermonAudioUploadUrl('file:///etc/passwd')).toBeNull();
    expect(resolveSermonAudioUploadUrl('https://upload.sermonaudio.com:8443/video')).toBeNull();
    expect(
      resolveSermonAudioUploadUrl('https://user:pass@upload.sermonaudio.com/video')
    ).toBeNull();
  });

  it('returns null for empty or invalid input', () => {
    expect(resolveSermonAudioUploadUrl('')).toBeNull();
    expect(resolveSermonAudioUploadUrl('   ')).toBeNull();
    expect(resolveSermonAudioUploadUrl('not a url')).toBeNull();
  });
});

describe('assertSermonAudioHttpOk', () => {
  it('resolves for OK responses', async () => {
    await expect(
      assertSermonAudioHttpOk(new Response('', { status: 200 }), 'failed')
    ).resolves.toBeUndefined();
  });

  it('throws SermonAudioUpstreamHttpError for non-OK responses', async () => {
    await expect(
      assertSermonAudioHttpOk(new Response('Unauthorized', { status: 401 }), 'failed')
    ).rejects.toMatchObject({
      name: 'SermonAudioUpstreamHttpError',
      status: 401,
      message: 'failed',
    });
  });
});

describe('isSermonAudioCredentialsFailure', () => {
  it('treats 401, 403, and 404 as credential failures', () => {
    expect(isSermonAudioCredentialsFailure(401)).toBe(true);
    expect(isSermonAudioCredentialsFailure(403)).toBe(true);
    expect(isSermonAudioCredentialsFailure(404)).toBe(true);
    expect(isSermonAudioCredentialsFailure(500)).toBe(false);
  });
});

describe('sermonAudioUpstreamResponseStatus', () => {
  it('maps rate limits and upstream outages to 503 and other errors to 502', () => {
    expect(sermonAudioUpstreamResponseStatus(429)).toBe(503);
    expect(sermonAudioUpstreamResponseStatus(503)).toBe(503);
    expect(sermonAudioUpstreamResponseStatus(500)).toBe(502);
  });
});
