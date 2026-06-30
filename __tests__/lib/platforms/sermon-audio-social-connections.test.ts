import { describe, expect, it } from 'vitest';
import {
  parseSermonAudioRefreshSocialResponse,
  sermonAudioRefreshSocialUrl,
} from '@/lib/platforms/sermon-audio-social-connections';

describe('parseSermonAudioRefreshSocialResponse', () => {
  it('maps refresh_social platforms to Cross Publish destination connection flags', () => {
    expect(
      parseSermonAudioRefreshSocialResponse({
        google: { hasOAUTH: false, name: null },
        facebook: {
          hasOAUTH: true,
          name: 'Covenant Reformed Presbyterian Church',
          pageName: 'Covenant Reformed Presbyterian Church',
        },
        twitter: { hasOAUTH: true, name: 'CRPCHalifax' },
        instagram: { hasOAUTH: false, username: null },
      })
    ).toEqual({
      youtube: { connected: false },
      facebook: {
        connected: true,
        displayName: 'Covenant Reformed Presbyterian Church',
      },
      x: { connected: true, displayName: 'CRPCHalifax' },
    });
  });

  it('returns disconnected defaults for invalid input', () => {
    expect(parseSermonAudioRefreshSocialResponse(null)).toEqual({
      youtube: { connected: false },
      facebook: { connected: false },
      x: { connected: false },
    });
  });
});

describe('sermonAudioRefreshSocialUrl', () => {
  it('builds the refresh_social URL for a broadcaster id', () => {
    expect(sermonAudioRefreshSocialUrl('crpc')).toBe(
      'https://api.sermonaudio.com/v2/node/broadcasters/crpc/refresh_social?cacheLanguage=en&cacheMax=181&cacheDomain=www.sermonaudio.com'
    );
  });
});
