'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Slider, SliderRange, SliderThumb, SliderTrack } from '@/components/ui/slider';
import type { YouTubePlayerHandle } from '@/components/youtube-import/YouTubePreviewPlayer';
import { cn } from '@/lib/utils';
import { formatVideoDuration } from '@/lib/format-video-duration';

/** Debounce interval before snapping trim handles to nearby keyframes. */
const KEYFRAME_SNAP_DEBOUNCE_MS = 250;

/** Debounce interval for preview seeks while dragging trim handles. */
const PREVIEW_SEEK_THROTTLE_MS = 200;

/**
 * Props for {@link TrimRangeSlider}.
 */
export interface TrimRangeSliderProps {
  /** Total source duration in seconds. */
  durationSeconds: number;
  /** YouTube video id used for keyframe probing. */
  youtubeVideoId: string;
  /** Current trim range in seconds. */
  value: { startSeconds: number; endSeconds: number };
  /**
   * Called when the user adjusts either handle (raw while dragging, snapped after settle).
   * @param value - Updated trim range.
   */
  onChange: (value: { startSeconds: number; endSeconds: number }) => void;
  /** Optional preview player handle to seek while trimming. */
  playerHandle?: YouTubePlayerHandle;
}

/**
 * Formats seconds as a YouTube-style duration label (`H:MM:SS` or `M:SS`).
 * @param seconds - Duration in seconds.
 * @returns Human-readable timestamp label.
 */
export function formatTrimSeconds(seconds: number): string {
  return formatVideoDuration(seconds);
}

/**
 * Picks the keyframe timestamp closest to the dragged position.
 * @param targetSeconds - Raw handle position in seconds.
 * @param candidates - Nearby keyframe timestamps from the API.
 * @returns Closest candidate, or the raw target when none are returned.
 */
export function pickClosestKeyframe(targetSeconds: number, candidates: number[]): number {
  if (candidates.length === 0) {
    return targetSeconds;
  }

  return candidates.reduce((closest, candidate) =>
    Math.abs(candidate - targetSeconds) < Math.abs(closest - targetSeconds) ? candidate : closest
  );
}

/**
 * Two-handle trim slider with debounced snap-to-keyframe behavior.
 * @param props - Slider configuration.
 * @returns Trim range slider UI.
 */
export function TrimRangeSlider({
  durationSeconds,
  youtubeVideoId,
  value,
  onChange,
  playerHandle,
}: TrimRangeSliderProps) {
  const [snappingHandle, setSnappingHandle] = useState<'start' | 'end' | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSnapRef = useRef<{ handle: 'start' | 'end'; seconds: number } | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const previewThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPreviewSecondsRef = useRef<number | null>(null);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const runKeyframeSnap = useCallback(
    async (handle: 'start' | 'end', rawSeconds: number) => {
      setSnappingHandle(handle);
      try {
        const params = new URLSearchParams({
          youtubeVideoId,
          near: String(rawSeconds),
        });
        const response = await fetch(`/api/youtube-import/keyframes?${params.toString()}`);
        if (!response.ok) {
          return;
        }

        const body: { data?: { keyframeSeconds?: number[] } } = await response.json();
        const candidates = body.data?.keyframeSeconds ?? [];
        const snappedSeconds = pickClosestKeyframe(rawSeconds, candidates);
        const current = valueRef.current;

        const nextValue =
          handle === 'start'
            ? {
                startSeconds: Math.min(snappedSeconds, current.endSeconds),
                endSeconds: current.endSeconds,
              }
            : {
                startSeconds: current.startSeconds,
                endSeconds: Math.max(snappedSeconds, current.startSeconds),
              };

        if (
          nextValue.startSeconds !== current.startSeconds ||
          nextValue.endSeconds !== current.endSeconds
        ) {
          onChangeRef.current(nextValue);
        }
      } catch (error) {
        console.error('[TrimRangeSlider] Keyframe snap request failed:', error);
      } finally {
        setSnappingHandle((currentHandle) => (currentHandle === handle ? null : currentHandle));
      }
    },
    [youtubeVideoId]
  );

  const scheduleKeyframeSnap = useCallback(
    (handle: 'start' | 'end', seconds: number) => {
      pendingSnapRef.current = { handle, seconds };
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        const pending = pendingSnapRef.current;
        pendingSnapRef.current = null;
        if (!pending) {
          return;
        }
        void runKeyframeSnap(pending.handle, pending.seconds);
      }, KEYFRAME_SNAP_DEBOUNCE_MS);
    },
    [runKeyframeSnap]
  );

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (previewThrottleTimerRef.current) {
        clearTimeout(previewThrottleTimerRef.current);
      }
    };
  }, []);

  const schedulePreviewAt = useCallback(
    (seconds: number) => {
      if (!playerHandle) {
        return;
      }

      pendingPreviewSecondsRef.current = seconds;
      if (previewThrottleTimerRef.current) {
        return;
      }

      previewThrottleTimerRef.current = setTimeout(() => {
        previewThrottleTimerRef.current = null;
        const pendingSeconds = pendingPreviewSecondsRef.current;
        if (pendingSeconds != null) {
          playerHandle.previewAt(pendingSeconds);
        }
      }, PREVIEW_SEEK_THROTTLE_MS);
    },
    [playerHandle]
  );

  const handleValueChange = useCallback(
    ([startSeconds, endSeconds]: number[]) => {
      const previous = valueRef.current;
      const startMoved = Math.abs(startSeconds - previous.startSeconds);
      const endMoved = Math.abs(endSeconds - previous.endSeconds);
      const movedHandle: 'start' | 'end' = startMoved >= endMoved ? 'start' : 'end';
      const movedSeconds = movedHandle === 'start' ? startSeconds : endSeconds;

      onChangeRef.current({ startSeconds, endSeconds });
      schedulePreviewAt(movedSeconds);
      scheduleKeyframeSnap(movedHandle, movedSeconds);
    },
    [scheduleKeyframeSnap, schedulePreviewAt]
  );

  const disabled = durationSeconds <= 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm tabular-nums text-muted-foreground">
        <span aria-live="polite">{formatTrimSeconds(value.startSeconds)}</span>
        <span aria-live="polite">{formatTrimSeconds(value.endSeconds)}</span>
      </div>

      <Slider
        min={0}
        max={Math.max(durationSeconds, 0)}
        step={0.1}
        value={[value.startSeconds, value.endSeconds]}
        onValueChange={handleValueChange}
        disabled={disabled}
        aria-label="Trim range"
      >
        <SliderTrack>
          <SliderRange />
        </SliderTrack>
        <SliderThumb
          data-testid="trim-start-thumb"
          className={cn(snappingHandle === 'start' && 'relative')}
          aria-label="Trim start"
        >
          {snappingHandle === 'start' ? (
            <Loader2
              data-testid="trim-start-loading"
              className="absolute -top-5 left-1/2 h-3 w-3 -translate-x-1/2 animate-spin text-primary"
              aria-hidden="true"
            />
          ) : null}
        </SliderThumb>
        <SliderThumb
          data-testid="trim-end-thumb"
          className={cn(snappingHandle === 'end' && 'relative')}
          aria-label="Trim end"
        >
          {snappingHandle === 'end' ? (
            <Loader2
              data-testid="trim-end-loading"
              className="absolute -top-5 left-1/2 h-3 w-3 -translate-x-1/2 animate-spin text-primary"
              aria-hidden="true"
            />
          ) : null}
        </SliderThumb>
      </Slider>
    </div>
  );
}
