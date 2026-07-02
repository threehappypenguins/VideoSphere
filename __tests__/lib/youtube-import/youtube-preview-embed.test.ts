import { describe, expect, it } from 'vitest';
import { buildYouTubePreviewEmbedUrl } from '@/lib/youtube-import/youtube-preview-embed';

describe('buildYouTubePreviewEmbedUrl', () => {
  it('includes enablejsapi, origin, and widget_referrer for embedded playback', () => {
    const url = new URL(buildYouTubePreviewEmbedUrl('dQw4w9WgXcQ', 'http://localhost:9624'));

    expect(url.origin).toBe('https://www.youtube.com');
    expect(url.pathname).toBe('/embed/dQw4w9WgXcQ');
    expect(url.searchParams.get('enablejsapi')).toBe('1');
    expect(url.searchParams.get('origin')).toBe('http://localhost:9624');
    expect(url.searchParams.get('widget_referrer')).toBe('http://localhost:9624');
    expect(url.searchParams.get('rel')).toBe('0');
    expect(url.searchParams.get('modestbranding')).toBe('1');
    expect(url.searchParams.get('playsinline')).toBe('1');
  });
});
