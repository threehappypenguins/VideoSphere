import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadYouTubeIframeApi,
  resetYouTubeIframeApiLoaderForTests,
} from '@/lib/youtube-import/load-youtube-iframe-api';

describe('loadYouTubeIframeApi', () => {
  beforeEach(() => {
    resetYouTubeIframeApiLoaderForTests();
    document.head.innerHTML = '';
    delete window.YT;
    window.onYouTubeIframeAPIReady = undefined;
  });

  afterEach(() => {
    resetYouTubeIframeApiLoaderForTests();
  });

  it('appends only one iframe API script when load is requested multiple times', () => {
    void loadYouTubeIframeApi();
    void loadYouTubeIframeApi();

    const scripts = document.querySelectorAll('script[src="https://www.youtube.com/iframe_api"]');
    expect(scripts).toHaveLength(1);
  });

  it('resolves immediately when YT.Player is already available', async () => {
    const mockPlayer = vi.fn();
    window.YT = { Player: mockPlayer };

    await expect(loadYouTubeIframeApi()).resolves.toBe(window.YT);
    expect(
      document.querySelectorAll('script[src="https://www.youtube.com/iframe_api"]')
    ).toHaveLength(0);
  });
});
