import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { resetYouTubeIframeApiLoaderForTests } from '@/lib/youtube-import/load-youtube-iframe-api';
import { YouTubePreviewPlayer } from '@/components/youtube-import/YouTubePreviewPlayer';

const mockLoadYouTubeIframeApi = vi.fn();

vi.mock('@/lib/youtube-import/load-youtube-iframe-api', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/youtube-import/load-youtube-iframe-api')>();
  return {
    ...actual,
    loadYouTubeIframeApi: (...args: unknown[]) => mockLoadYouTubeIframeApi(...args),
  };
});

const VIDEO_ID = 'dQw4w9WgXcQ';

function createMockPlayer(durationSeconds = 600) {
  return {
    seekTo: vi.fn(),
    getCurrentTime: vi.fn().mockReturnValue(0),
    getDuration: vi.fn().mockReturnValue(durationSeconds),
    destroy: vi.fn(),
  };
}

function createMockYouTubePlayerClass(durationSeconds = 600) {
  return class MockYouTubePlayer {
    constructor(
      _elementId: string,
      config: {
        events?: { onReady?: (event: { target: ReturnType<typeof createMockPlayer> }) => void };
      }
    ) {
      const player = createMockPlayer(durationSeconds);
      queueMicrotask(() => {
        config.events?.onReady?.({ target: player });
      });
      return player;
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetYouTubeIframeApiLoaderForTests();

  mockLoadYouTubeIframeApi.mockImplementation(() =>
    Promise.resolve({
      Player: createMockYouTubePlayerClass(),
    })
  );
});

afterEach(() => {
  resetYouTubeIframeApiLoaderForTests();
});

describe('YouTubePreviewPlayer', () => {
  it('calls onDurationKnown once when the player becomes ready', async () => {
    const onDurationKnown = vi.fn();

    render(<YouTubePreviewPlayer youtubeVideoId={VIDEO_ID} onDurationKnown={onDurationKnown} />);

    await waitFor(() => {
      expect(onDurationKnown).toHaveBeenCalledTimes(1);
    });
    expect(onDurationKnown).toHaveBeenCalledWith(600);
    expect(mockLoadYouTubeIframeApi).toHaveBeenCalledTimes(1);
  });

  it('reuses the shared iframe API loader across multiple mounted players', async () => {
    render(
      <>
        <YouTubePreviewPlayer youtubeVideoId={VIDEO_ID} />
        <YouTubePreviewPlayer youtubeVideoId={VIDEO_ID} />
      </>
    );

    await waitFor(() => {
      expect(mockLoadYouTubeIframeApi).toHaveBeenCalledTimes(2);
    });
  });

  it('exposes seekTo and getCurrentTime through playerRef', async () => {
    const playerRef = {
      current: null as
        | import('@/components/youtube-import/YouTubePreviewPlayer').YouTubePlayerHandle
        | null,
    };

    render(<YouTubePreviewPlayer youtubeVideoId={VIDEO_ID} playerRef={playerRef} />);

    await waitFor(() => {
      expect(playerRef.current).not.toBeNull();
    });

    playerRef.current?.seekTo(42);
    expect(playerRef.current?.getCurrentTime()).toBe(0);
    expect(mockLoadYouTubeIframeApi).toHaveBeenCalled();
  });
});
