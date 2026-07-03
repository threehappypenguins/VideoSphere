import { describe, expect, it } from 'vitest';
import {
  isYouTubeAuthCredentialsError,
  YOUTUBE_RECONNECT_MESSAGE,
} from '@/lib/platforms/youtube-auth-errors';
import { youtubeUpstreamErrorResponse } from '@/lib/platforms/youtube-api';

describe('isYouTubeAuthCredentialsError', () => {
  it('detects Google invalid authentication credential messages', () => {
    expect(
      isYouTubeAuthCredentialsError(
        'Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.'
      )
    ).toBe(true);
  });

  it('returns false for unrelated upstream failures', () => {
    expect(isYouTubeAuthCredentialsError('Quota exceeded')).toBe(false);
  });
});

describe('youtubeUpstreamErrorResponse', () => {
  it('maps auth credential failures to 401 with reconnect guidance', async () => {
    const response = youtubeUpstreamErrorResponse(
      'Request had invalid authentication credentials.',
      401
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      statusCode: 401,
      message: YOUTUBE_RECONNECT_MESSAGE,
    });
  });

  it('keeps non-auth upstream failures as 502', async () => {
    const response = youtubeUpstreamErrorResponse('Quota exceeded', 403);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      statusCode: 502,
      message: 'Quota exceeded',
    });
  });
});
