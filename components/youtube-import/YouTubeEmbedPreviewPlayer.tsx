'use client';

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { YouTubePlayerHandle } from '@/components/youtube-import/YouTubePreviewPlayer';

const YOUTUBE_IFRAME_API_SRC = 'https://www.youtube.com/iframe_api';

/** Minimal YouTube IFrame Player API surface used for import preview. */
interface YouTubeIframePlayer {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  destroy(): void;
}

interface YouTubeIframePlayerOptions {
  videoId: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (event: { target: YouTubeIframePlayer }) => void;
    onError?: (event: { data: number }) => void;
  };
}

interface YouTubeIframeApi {
  Player: new (
    element: HTMLElement | string,
    options: YouTubeIframePlayerOptions
  ) => YouTubeIframePlayer;
}

declare global {
  interface Window {
    YT?: YouTubeIframeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let iframeApiPromise: Promise<void> | null = null;

/**
 * Loads the YouTube IFrame Player API script once per page.
 * @returns Promise that resolves when `window.YT.Player` is available.
 */
function loadYouTubeIframeApi(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('YouTube IFrame API requires a browser environment'));
  }

  if (window.YT?.Player) {
    return Promise.resolve();
  }

  if (iframeApiPromise) {
    return iframeApiPromise;
  }

  iframeApiPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${YOUTUBE_IFRAME_API_SRC}"]`
    );
    if (existingScript) {
      if (window.YT?.Player) {
        resolve();
        return;
      }

      const previousReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previousReady?.();
        resolve();
      };
      return;
    }

    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      resolve();
    };

    const script = document.createElement('script');
    script.src = YOUTUBE_IFRAME_API_SRC;
    script.async = true;
    script.onerror = () => {
      iframeApiPromise = null;
      reject(new Error('Failed to load YouTube IFrame Player API'));
    };
    document.head.appendChild(script);
  });

  return iframeApiPromise;
}

/**
 * Props for {@link YouTubeEmbedPreviewPlayer}.
 */
export interface YouTubeEmbedPreviewPlayerProps {
  /** YouTube video id to preview. */
  youtubeVideoId: string;
  /** Optional ref receiving imperative playback controls. */
  playerRef?: React.RefObject<YouTubePlayerHandle | null>;
}

/**
 * YouTube IFrame Player preview for import trim when no direct stream is available.
 * @param props - Player configuration.
 * @returns Embed preview player container element.
 */
export function YouTubeEmbedPreviewPlayer({
  youtubeVideoId,
  playerRef,
}: YouTubeEmbedPreviewPlayerProps) {
  return (
    <YouTubeEmbedPreviewPlayerInner
      key={youtubeVideoId}
      youtubeVideoId={youtubeVideoId}
      playerRef={playerRef}
    />
  );
}

function YouTubeEmbedPreviewPlayerInner({
  youtubeVideoId,
  playerRef,
}: YouTubeEmbedPreviewPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerInstanceRef = useRef<YouTubeIframePlayer | null>(null);
  const pendingPreviewSecondsRef = useRef<number | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  const seekPreviewTo = useCallback((seconds: number) => {
    const player = playerInstanceRef.current;
    const clampedSeconds = Math.max(0, seconds);
    if (!player) {
      pendingPreviewSecondsRef.current = clampedSeconds;
      return;
    }

    player.seekTo(clampedSeconds, true);
  }, []);

  const previewAt = useCallback(
    (seconds: number) => {
      seekPreviewTo(seconds);
    },
    [seekPreviewTo]
  );

  useImperativeHandle(
    playerRef,
    () => ({
      previewAt(seconds: number) {
        previewAt(seconds);
      },
      getCurrentTime() {
        return playerInstanceRef.current?.getCurrentTime() ?? 0;
      },
    }),
    [previewAt]
  );

  useEffect(() => {
    pendingPreviewSecondsRef.current = null;

    let disposed = false;
    let player: YouTubeIframePlayer | null = null;

    void (async () => {
      try {
        await loadYouTubeIframeApi();
        if (disposed || !containerRef.current || !window.YT?.Player) {
          return;
        }

        player = new window.YT.Player(containerRef.current, {
          videoId: youtubeVideoId,
          playerVars: {
            controls: 1,
            modestbranding: 1,
            rel: 0,
            fs: 0,
            playsinline: 1,
          },
          events: {
            onReady: (event) => {
              if (disposed) {
                return;
              }

              playerInstanceRef.current = event.target;
              const pendingSeconds = pendingPreviewSecondsRef.current;
              if (pendingSeconds != null) {
                pendingPreviewSecondsRef.current = null;
                event.target.seekTo(pendingSeconds, true);
              }
            },
            onError: () => {
              if (disposed) {
                return;
              }
              setPlaybackError(
                'Embed preview failed to load. Confirm the video is accessible on YouTube and try again.'
              );
            },
          },
        });
        playerInstanceRef.current = player;
      } catch (error) {
        if (!disposed) {
          const message = error instanceof Error ? error.message : 'Failed to load embed preview';
          setPlaybackError(message);
        }
      }
    })();

    return () => {
      disposed = true;
      playerInstanceRef.current = null;
      player?.destroy();
    };
  }, [youtubeVideoId]);

  return (
    <div className="space-y-2" data-testid="youtube-embed-preview-player">
      <div className="aspect-video w-full overflow-hidden rounded-md border border-border bg-black">
        <div
          ref={containerRef}
          className="h-full w-full"
          aria-label="YouTube import trim preview"
        />
      </div>
      {playbackError ? (
        <p className="text-xs text-destructive" role="alert">
          {playbackError}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Preview uses YouTube&apos;s embed player. Trim points are approximate in the preview;
          smart cut produces frame-accurate cuts after download.
        </p>
      )}
    </div>
  );
}
