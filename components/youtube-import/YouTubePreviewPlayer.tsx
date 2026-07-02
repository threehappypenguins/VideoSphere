'use client';

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { ApiResponse } from '@/types';

/** Refresh preview URLs one minute before yt-dlp reports expiry. */
const PREVIEW_URL_REFRESH_BUFFER_MS = 60_000;

/** Empty WebVTT track — proxied preview has no captions; satisfies media caption lint. */
const PREVIEW_NO_CAPTIONS_TRACK_SRC =
  'data:text/vtt;charset=utf-8,' +
  encodeURIComponent('WEBVTT\n\nNOTE No captions for import preview\n');

/**
 * Imperative handle for controlling YouTube preview playback from sibling components.
 */
export interface YouTubePlayerHandle {
  /**
   * Seeks the preview player to the given timestamp.
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
  /** Same-origin proxied preview stream URL from resolve. */
  streamUrl: string;
  /** Approximate Unix expiry for the proxied preview media URL. */
  previewExpiresAt: number;
  /**
   * Called once when the player is ready and duration is known.
   * @param seconds - Total video duration in seconds.
   */
  onDurationKnown?: (seconds: number) => void;
  /** Optional ref receiving imperative playback controls. */
  playerRef?: React.RefObject<YouTubePlayerHandle | null>;
}

/**
 * HTML5 preview player for import trim using a proxied yt-dlp media stream.
 * @param props - Player configuration.
 * @returns Preview player container element.
 */
export function YouTubePreviewPlayer({
  youtubeVideoId,
  streamUrl,
  previewExpiresAt,
  onDurationKnown,
  playerRef,
}: YouTubePreviewPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onDurationKnownRef = useRef(onDurationKnown);
  const pendingPreviewSecondsRef = useRef<number | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [expiresAt, setExpiresAt] = useState(previewExpiresAt);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  const streamSrc = useMemo(() => {
    const url = new URL(streamUrl, 'http://localhost');
    if (refreshKey > 0) {
      url.searchParams.set('refresh', '1');
    }
    return `${url.pathname}${url.search}`;
  }, [refreshKey, streamUrl]);

  useEffect(() => {
    onDurationKnownRef.current = onDurationKnown;
  }, [onDurationKnown]);

  useEffect(() => {
    setRefreshKey(0);
    setExpiresAt(previewExpiresAt);
    setPlaybackError(null);
    pendingPreviewSecondsRef.current = null;
  }, [previewExpiresAt, streamUrl, youtubeVideoId]);

  const previewAt = useCallback((seconds: number) => {
    const video = videoRef.current;
    const clampedSeconds = Math.max(0, seconds);
    if (!video || video.readyState < HTMLMediaElement.HAVE_METADATA) {
      pendingPreviewSecondsRef.current = clampedSeconds;
      return;
    }

    video.currentTime = clampedSeconds;
  }, []);

  useImperativeHandle(
    playerRef,
    () => ({
      previewAt(seconds: number) {
        previewAt(seconds);
      },
      getCurrentTime() {
        return videoRef.current?.currentTime ?? 0;
      },
    }),
    [previewAt]
  );

  useEffect(() => {
    const clearRefreshTimer = () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };

    const refreshPreview = () => {
      void (async () => {
        try {
          const params = new URLSearchParams({
            youtubeVideoId,
            refresh: '1',
          });
          const response = await fetch(`/api/youtube-import/preview?${params.toString()}`, {
            cache: 'no-store',
          });
          if (!response.ok) {
            throw new Error('Failed to refresh preview media');
          }

          const body = (await response.json()) as ApiResponse<{
            streamUrl: string;
            expiresAt: number;
          }>;
          setExpiresAt(body.data.expiresAt);
          setRefreshKey((current) => current + 1);
        } catch (error) {
          console.error('[YouTubePreviewPlayer] Failed to refresh preview media:', error);
        }
      })();
    };

    const delayMs = expiresAt - Date.now() - PREVIEW_URL_REFRESH_BUFFER_MS;
    if (delayMs <= 0) {
      refreshPreview();
      return clearRefreshTimer;
    }

    refreshTimerRef.current = setTimeout(refreshPreview, delayMs);

    return clearRefreshTimer;
  }, [expiresAt, youtubeVideoId]);

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    setPlaybackError(null);

    if (Number.isFinite(video.duration) && video.duration > 0) {
      onDurationKnownRef.current?.(video.duration);
    }

    const pendingSeconds = pendingPreviewSecondsRef.current;
    if (pendingSeconds != null) {
      pendingPreviewSecondsRef.current = null;
      video.currentTime = pendingSeconds;
    }
  };

  const handleVideoError = () => {
    if (refreshKey === 0) {
      setRefreshKey(1);
      return;
    }

    setPlaybackError(
      'Preview playback failed. Confirm the video is accessible on YouTube and try again.'
    );
  };

  return (
    <div className="space-y-2">
      <div className="aspect-video w-full overflow-hidden rounded-md border border-border bg-black">
        <video
          key={`${youtubeVideoId}-${refreshKey}`}
          ref={videoRef}
          src={streamSrc}
          controls
          preload="metadata"
          playsInline
          aria-label="YouTube import trim preview"
          className="h-full w-full"
          onLoadedMetadata={handleLoadedMetadata}
          onError={handleVideoError}
        >
          <track
            kind="captions"
            src={PREVIEW_NO_CAPTIONS_TRACK_SRC}
            label="No captions for preview"
          />
        </video>
      </div>
      {playbackError ? (
        <p className="text-xs text-destructive" role="alert">
          {playbackError}
        </p>
      ) : null}
    </div>
  );
}
