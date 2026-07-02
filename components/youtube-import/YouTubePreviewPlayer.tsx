'use client';

import { useEffect, useId, useImperativeHandle, useRef } from 'react';
import {
  loadYouTubeIframeApi,
  type YouTubeIframePlayerInstance,
} from '@/lib/youtube-import/load-youtube-iframe-api';

/**
 * Imperative handle for controlling YouTube preview playback from sibling components.
 */
export interface YouTubePlayerHandle {
  /**
   * Seeks the preview player to the given timestamp.
   * @param seconds - Target playback position in seconds.
   */
  seekTo(seconds: number): void;
  /**
   * Returns the player's current playback position in seconds.
   * @returns Current time in seconds, or 0 when the player is not ready.
   */
  getCurrentTime(): number;
}

/**
 * Props for {@link YouTubePreviewPlayer}.
 */
export interface YouTubePreviewPlayerProps {
  /** YouTube video id to preview. */
  youtubeVideoId: string;
  /**
   * Called once when the player is ready and duration is known.
   * @param seconds - Total video duration in seconds.
   */
  onDurationKnown?: (seconds: number) => void;
  /** Optional ref receiving imperative playback controls. */
  playerRef?: React.RefObject<YouTubePlayerHandle | null>;
}

/**
 * Embeds a YouTube IFrame player for import trim preview.
 * @param props - Player configuration.
 * @returns Preview player container element.
 */
export function YouTubePreviewPlayer({
  youtubeVideoId,
  onDurationKnown,
  playerRef,
}: YouTubePreviewPlayerProps) {
  const containerId = useId().replace(/:/g, '');
  const playerInstanceRef = useRef<YouTubeIframePlayerInstance | null>(null);
  const onDurationKnownRef = useRef(onDurationKnown);

  useEffect(() => {
    onDurationKnownRef.current = onDurationKnown;
  }, [onDurationKnown]);

  useImperativeHandle(
    playerRef,
    () => ({
      seekTo(seconds: number) {
        playerInstanceRef.current?.seekTo(seconds, true);
      },
      getCurrentTime() {
        return playerInstanceRef.current?.getCurrentTime() ?? 0;
      },
    }),
    []
  );

  useEffect(() => {
    let cancelled = false;
    let player: YouTubeIframePlayerInstance | null = null;

    void loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled) {
          return;
        }

        player = new YT.Player(containerId, {
          videoId: youtubeVideoId,
          playerVars: {
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
          },
          events: {
            onReady(event) {
              if (cancelled) {
                return;
              }
              playerInstanceRef.current = event.target;
              const duration = event.target.getDuration();
              if (Number.isFinite(duration) && duration > 0) {
                onDurationKnownRef.current?.(duration);
              }
            },
          },
        });
        playerInstanceRef.current = player;
      })
      .catch((error) => {
        console.error('[YouTubePreviewPlayer] Failed to initialize player:', error);
      });

    return () => {
      cancelled = true;
      playerInstanceRef.current = null;
      player?.destroy();
    };
  }, [containerId, youtubeVideoId]);

  return (
    <div className="aspect-video w-full overflow-hidden rounded-md border border-border bg-black">
      <div id={containerId} className="h-full w-full" />
    </div>
  );
}
