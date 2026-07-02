'use client';

import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  loadYouTubeIframeApi,
  YouTubePlayerState,
  type YouTubeIframePlayerInstance,
} from '@/lib/youtube-import/load-youtube-iframe-api';
import { buildYouTubePreviewEmbedUrl } from '@/lib/youtube-import/youtube-preview-embed';

/**
 * Imperative handle for controlling YouTube preview playback from sibling components.
 */
export interface YouTubePlayerHandle {
  /**
   * Shows the frame at the given timestamp without starting playback when possible.
   * @param seconds - Target playback position in seconds.
   */
  previewAt(seconds: number): void;
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
 * Returns a user-facing message for a YouTube player error code.
 * @param errorCode - Numeric error code from the IFrame API `onError` event.
 * @returns Human-readable playback error message.
 */
export function youtubePreviewPlayerErrorMessage(errorCode: number): string {
  switch (errorCode) {
    case 2:
      return 'YouTube rejected the preview request (invalid player parameters).';
    case 5:
      return 'YouTube could not play this video in the embedded HTML5 player.';
    case 100:
      return 'This video was not found or is no longer available.';
    case 101:
    case 150:
      return 'The video owner does not allow playback in embedded players.';
    case 153:
      return 'YouTube could not verify this embed (missing referrer information).';
    default:
      return 'YouTube playback failed. Try again on youtube.com to confirm the video plays there.';
  }
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
  const iframeId = useId().replace(/:/g, '');
  const playerInstanceRef = useRef<YouTubeIframePlayerInstance | null>(null);
  const onDurationKnownRef = useRef(onDurationKnown);
  const isReadyRef = useRef(false);
  const pendingPreviewSecondsRef = useRef<number | null>(null);
  const pageOrigin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => ''
  );
  const embedSrc = pageOrigin ? buildYouTubePreviewEmbedUrl(youtubeVideoId, pageOrigin) : null;
  const [playbackErrorForEmbed, setPlaybackErrorForEmbed] = useState<{
    embedSrc: string;
    message: string;
  } | null>(null);
  const playbackError =
    embedSrc && playbackErrorForEmbed?.embedSrc === embedSrc ? playbackErrorForEmbed.message : null;

  useEffect(() => {
    onDurationKnownRef.current = onDurationKnown;
  }, [onDurationKnown]);

  const previewAt = useCallback(
    (seconds: number) => {
      const player = playerInstanceRef.current;
      if (!player || !isReadyRef.current) {
        pendingPreviewSecondsRef.current = Math.max(0, seconds);
        return;
      }

      const clampedSeconds = Math.max(0, seconds);
      const state = player.getPlayerState();

      if (state === YouTubePlayerState.PLAYING || state === YouTubePlayerState.BUFFERING) {
        player.seekTo(clampedSeconds, true);
        return;
      }

      player.cueVideoById({
        videoId: youtubeVideoId,
        startSeconds: clampedSeconds,
      });
    },
    [youtubeVideoId]
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
    if (!embedSrc) {
      return;
    }

    let cancelled = false;
    let player: YouTubeIframePlayerInstance | null = null;

    isReadyRef.current = false;
    pendingPreviewSecondsRef.current = null;

    void loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled) {
          return;
        }

        player = new YT.Player(iframeId, {
          events: {
            onReady(event) {
              if (cancelled) {
                return;
              }
              playerInstanceRef.current = event.target;
              isReadyRef.current = true;
              const duration = event.target.getDuration();
              if (Number.isFinite(duration) && duration > 0) {
                onDurationKnownRef.current?.(duration);
              }

              const pendingSeconds = pendingPreviewSecondsRef.current;
              if (pendingSeconds != null) {
                pendingPreviewSecondsRef.current = null;
                previewAt(pendingSeconds);
              }
            },
            onStateChange() {
              setPlaybackErrorForEmbed((current) =>
                current?.embedSrc === embedSrc ? null : current
              );
            },
            onError(event) {
              if (cancelled) {
                return;
              }
              setPlaybackErrorForEmbed({
                embedSrc,
                message: youtubePreviewPlayerErrorMessage(event.data),
              });
            },
          },
        });
        playerInstanceRef.current = player;
      })
      .catch((error) => {
        console.error('[YouTubePreviewPlayer] Failed to initialize player:', error);
        if (!cancelled) {
          setPlaybackErrorForEmbed({
            embedSrc,
            message: 'Failed to load the YouTube preview player.',
          });
        }
      });

    return () => {
      cancelled = true;
      isReadyRef.current = false;
      playerInstanceRef.current = null;
      player?.destroy();
    };
  }, [embedSrc, iframeId, previewAt]);

  return (
    <div className="space-y-2">
      <div className="aspect-video w-full overflow-hidden rounded-md border border-border bg-black">
        {embedSrc ? (
          <iframe
            id={iframeId}
            title="YouTube preview"
            src={embedSrc}
            referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="h-full w-full"
          />
        ) : null}
      </div>
      {playbackError ? (
        <p className="text-xs text-destructive" role="alert">
          {playbackError}
        </p>
      ) : null}
    </div>
  );
}
