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

  it('refreshes immediately when preview URL is within the refresh buffer', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            streamUrl: STREAM_URL,
            expiresAt: Date.now() + 3_600_000,
          },
        }),
        { status: 200 }
      )
    );

    render(
      <YouTubePreviewPlayer
        youtubeVideoId={VIDEO_ID}
        streamUrl={STREAM_URL}
        previewExpiresAt={Date.now() + 30_000}
      />
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/api/youtube-import/preview?youtubeVideoId=${VIDEO_ID}`),
        expect.objectContaining({ cache: 'no-store' })
      );
    });

    expect(fetchMock.mock.calls[0]?.[0]).toContain('refresh=1');
  });

  it('resets refresh state when preview source props change', () => {
    const otherVideoId = 'abc123xyz90';
    const otherStreamUrl = `/api/youtube-import/preview/stream?youtubeVideoId=${otherVideoId}`;

    const { container, rerender } = render(
      <YouTubePreviewPlayer
        youtubeVideoId={VIDEO_ID}
        streamUrl={STREAM_URL}
        previewExpiresAt={PREVIEW_EXPIRES_AT}
      />
    );

    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    fireEvent.error(video!);

    rerender(
      <YouTubePreviewPlayer
        youtubeVideoId={otherVideoId}
        streamUrl={otherStreamUrl}
        previewExpiresAt={PREVIEW_EXPIRES_AT + 1_000}
      />
    );

    const nextVideo = container.querySelector('video');
    expect(nextVideo).not.toHaveAttribute('src', expect.stringContaining('refresh=1'));
    expect(nextVideo).toHaveAttribute('src', otherStreamUrl);
  });
});
