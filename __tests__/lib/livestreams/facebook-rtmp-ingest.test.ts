import { describe, expect, it } from 'vitest';
import { splitFacebookRtmpIngestUrl } from '@/lib/livestreams/facebook-rtmp-ingest';

describe('splitFacebookRtmpIngestUrl', () => {
  it('keeps /rtmp/ on the server URL for encoder paste fields', () => {
    expect(
      splitFacebookRtmpIngestUrl(
        'rtmps://live-api-s.facebook.com:443/rtmp/FB-1412016960959699-0-AbCdEf'
      )
    ).toEqual({
      serverUrl: 'rtmps://live-api-s.facebook.com:443/rtmp/',
      streamKey: 'FB-1412016960959699-0-AbCdEf',
    });
  });

  it('returns null when /rtmp/ is missing', () => {
    expect(splitFacebookRtmpIngestUrl('rtmps://live-api-s.facebook.com:443/FB-1')).toBeNull();
  });
});
