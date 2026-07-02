import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { YouTubePreviewPlayer } from '@/components/youtube-import/YouTubePreviewPlayer';

const VIDEO_ID = 'dQw4w9WgXcQ';
const STREAM_URL = `/api/youtube-import/preview/stream?youtubeVideoId=${VIDEO_ID}`;
const PREVIEW_EXPIRES_AT = Date.now() + 3_600_000;

describe('YouTubePreviewPlayer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get() {
        return 600;
      },
    });
  });

  it('renders a video element pointed at the proxied stream URL', () => {
    const { container } = render(
      <YouTubePreviewPlayer
        youtubeVideoId={VIDEO_ID}
        streamUrl={STREAM_URL}
        previewExpiresAt={PREVIEW_EXPIRES_AT}
      />
    );

    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute('src', STREAM_URL);
    expect(video).toHaveAttribute('controls');
  });

  it('calls onDurationKnown when metadata loads', async () => {
    const onDurationKnown = vi.fn();

    const { container } = render(
      <YouTubePreviewPlayer
        youtubeVideoId={VIDEO_ID}
        streamUrl={STREAM_URL}
        previewExpiresAt={PREVIEW_EXPIRES_AT}
        onDurationKnown={onDurationKnown}
      />
    );

    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    fireEvent.loadedMetadata(video!);

    await waitFor(() => {
      expect(onDurationKnown).toHaveBeenCalledWith(600);
    });
  });

  it('exposes previewAt and getCurrentTime through playerRef', async () => {
    const playerRef = {
      current: null as
        | import('@/components/youtube-import/YouTubePreviewPlayer').YouTubePlayerHandle
        | null,
    };

    const { container } = render(
      <YouTubePreviewPlayer
        youtubeVideoId={VIDEO_ID}
        streamUrl={STREAM_URL}
        previewExpiresAt={PREVIEW_EXPIRES_AT}
        playerRef={playerRef}
      />
    );

    const video = container.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'readyState', {
      configurable: true,
      get() {
        return HTMLMediaElement.HAVE_METADATA;
      },
    });
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      writable: true,
      value: 0,
    });

    fireEvent.loadedMetadata(video);

    playerRef.current?.previewAt(42);
    expect(video.currentTime).toBe(42);
    expect(playerRef.current?.getCurrentTime()).toBe(42);
  });
});
