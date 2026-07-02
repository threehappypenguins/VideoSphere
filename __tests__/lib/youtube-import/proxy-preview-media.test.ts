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
});
