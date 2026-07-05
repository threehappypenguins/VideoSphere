import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { YouTubeEmbedPreviewPlayer } from '@/components/youtube-import/YouTubeEmbedPreviewPlayer';
import type { YouTubePlayerHandle } from '@/components/youtube-import/YouTubePreviewPlayer';

const VIDEO_ID = 'dQw4w9WgXcQ';

describe('YouTubeEmbedPreviewPlayer', () => {
  const mockSeekTo = vi.fn();
  const mockGetCurrentTime = vi.fn();
  const mockDestroy = vi.fn();

  class MockYouTubePlayer {
    seekTo = mockSeekTo;
    getCurrentTime = mockGetCurrentTime;
    destroy = mockDestroy;

    constructor(
      _element: HTMLElement,
      options?: {
        videoId?: string;
        events?: {
          onReady?: (event: { target: MockYouTubePlayer }) => void;
        };
      }
    ) {
      options?.events?.onReady?.({ target: this });
    }
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    mockSeekTo.mockReset();
    mockGetCurrentTime.mockReset();
    mockDestroy.mockReset();
    mockGetCurrentTime.mockReturnValue(42);

    window.YT = {
      Player: MockYouTubePlayer as unknown as NonNullable<typeof window.YT>['Player'],
    };
  });

  it('renders an embed preview container and creates a YT.Player for the video id', async () => {
    const playerSpy = vi.spyOn(window.YT!, 'Player');
    const { container } = render(<YouTubeEmbedPreviewPlayer youtubeVideoId={VIDEO_ID} />);

    expect(screen.getByTestId('youtube-embed-preview-player')).toBeInTheDocument();

    await waitFor(() => {
      expect(playerSpy).toHaveBeenCalledWith(
        container.querySelector('.aspect-video div'),
        expect.objectContaining({
          videoId: VIDEO_ID,
        })
      );
    });
  });

  it('exposes previewAt and getCurrentTime through playerRef', async () => {
    const playerRef = { current: null as YouTubePlayerHandle | null };

    render(<YouTubeEmbedPreviewPlayer youtubeVideoId={VIDEO_ID} playerRef={playerRef} />);

    await waitFor(() => {
      expect(playerRef.current).not.toBeNull();
    });

    playerRef.current?.previewAt(120);

    await waitFor(() => {
      expect(mockSeekTo).toHaveBeenCalledWith(120, true);
    });

    expect(playerRef.current?.getCurrentTime()).toBe(42);
  });

  it('destroys the player on unmount', async () => {
    const playerSpy = vi.spyOn(window.YT!, 'Player');
    const { unmount } = render(<YouTubeEmbedPreviewPlayer youtubeVideoId={VIDEO_ID} />);

    await waitFor(() => {
      expect(playerSpy).toHaveBeenCalled();
    });

    unmount();

    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
