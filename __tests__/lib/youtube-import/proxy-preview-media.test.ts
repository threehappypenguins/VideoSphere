import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchProxiedPreviewMedia } from '@/lib/youtube-import/proxy-preview-media';

describe('fetchProxiedPreviewMedia', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards range requests to the upstream media URL', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('video-bytes', {
        status: 206,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Range': 'bytes 0-99/1000',
          'Accept-Ranges': 'bytes',
        },
      })
    );

    const response = await fetchProxiedPreviewMedia(
      'https://r1---sn.example.googlevideo.com/videoplayback',
      'bytes=0-99'
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://r1---sn.example.googlevideo.com/videoplayback',
      expect.objectContaining({
        headers: expect.objectContaining({ Range: 'bytes=0-99' }),
      })
    );
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 0-99/1000');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('retries without a Range header when the upstream response is 416', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 416 }))
      .mockResolvedValueOnce(
        new Response('video-bytes', {
          status: 200,
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': '11',
            'Accept-Ranges': 'bytes',
          },
        })
      );

    const response = await fetchProxiedPreviewMedia(
      'https://r1---sn.example.googlevideo.com/videoplayback',
      'bytes=9999-'
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        headers: { Accept: '*/*' },
      })
    );
    expect(response.status).toBe(200);
  });
});
