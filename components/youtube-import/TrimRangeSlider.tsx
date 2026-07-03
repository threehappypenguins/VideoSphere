'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider, SliderRange, SliderThumb, SliderTrack } from '@/components/ui/slider';
import type { YouTubePlayerHandle } from '@/components/youtube-import/YouTubePreviewPlayer';
import { cn } from '@/lib/utils';
import { formatVideoDuration } from '@/lib/format-video-duration';

/** Debounce interval for preview seeks while dragging trim handles. */
const PREVIEW_SEEK_THROTTLE_MS = 100;

/** Ignore keyframe candidates farther than this from the released handle position. */
const MAX_KEYFRAME_SNAP_DISTANCE_SECONDS = 4;

/** Step size for arrow keys and on-screen nudge buttons (~one 30fps frame). */
export const TRIM_NUDGE_STEP_SECONDS = 1 / 30;

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
  /** When false, trim handles stay where released without keyframe probing. */
  enableKeyframeSnap?: boolean;
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
 * @returns Closest candidate, or the raw target when none are close enough.
 */
export function pickClosestKeyframe(targetSeconds: number, candidates: number[]): number {
  if (candidates.length === 0) {
    return targetSeconds;
  }

  const closest = candidates.reduce((best, candidate) =>
    Math.abs(candidate - targetSeconds) < Math.abs(best - targetSeconds) ? candidate : best
  );

  if (Math.abs(closest - targetSeconds) > MAX_KEYFRAME_SNAP_DISTANCE_SECONDS) {
    return targetSeconds;
  }

  return closest;
}

/**
 * Clamps a trim timestamp to an inclusive min/max range.
 * @param seconds - Candidate timestamp in seconds.
 * @param min - Lower bound in seconds.
 * @param max - Upper bound in seconds.
 * @returns Clamped timestamp.
 */
export function clampTrimSeconds(seconds: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, seconds));
}

/**
 * Applies one frame-step nudge to a trim handle.
 * @param value - Current trim range in seconds.
 * @param handle - Which handle to move.
 * @param direction - `-1` for earlier, `1` for later.
 * @param durationSeconds - Total source duration in seconds.
 * @param stepSeconds - Nudge distance in seconds.
 * @returns Updated trim range, or `null` when the handle cannot move further.
 */
export function nudgeTrimHandleValue(
  value: { startSeconds: number; endSeconds: number },
  handle: 'start' | 'end',
  direction: -1 | 1,
  durationSeconds: number,
  stepSeconds: number = TRIM_NUDGE_STEP_SECONDS
): { startSeconds: number; endSeconds: number } | null {
  const max = Math.max(durationSeconds, 0);
  const delta = direction * stepSeconds;

  if (handle === 'start') {
    const nextStart = clampTrimSeconds(value.startSeconds + delta, 0, value.endSeconds);
    if (nextStart === value.startSeconds) {
      return null;
    }
    return { startSeconds: nextStart, endSeconds: value.endSeconds };
  }

  const nextEnd = clampTrimSeconds(value.endSeconds + delta, value.startSeconds, max);
  if (nextEnd === value.endSeconds) {
    return null;
  }
  return { startSeconds: value.startSeconds, endSeconds: nextEnd };
}

/**
 * Two-handle trim slider with keyframe snap on handle release.
 * @param props - Slider configuration.
 * @returns Trim range slider UI.
 */
export function TrimRangeSlider({
  durationSeconds,
  youtubeVideoId,
  value,
  onChange,
  playerHandle,
  enableKeyframeSnap = true,
}: TrimRangeSliderProps) {
  const [snappingHandle, setSnappingHandle] = useState<'start' | 'end' | null>(null);
  const snapRequestIdRef = useRef(0);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const playerHandleRef = useRef(playerHandle);
  const previewThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPreviewSecondsRef = useRef<number | null>(null);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    playerHandleRef.current = playerHandle;
  }, [playerHandle]);

  const runKeyframeSnap = useCallback(
    async (handle: 'start' | 'end', rawSeconds: number, requestId: number) => {
      setSnappingHandle(handle);
      try {
        const params = new URLSearchParams({
          youtubeVideoId,
          near: String(rawSeconds),
        });
        const response = await fetch(`/api/youtube-import/keyframes?${params.toString()}`);
        if (!response.ok || requestId !== snapRequestIdRef.current) {
          return;
        }

        const body: { data?: { keyframeSeconds?: number[] } } = await response.json();
        if (requestId !== snapRequestIdRef.current) {
          return;
        }

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
          const previewSeconds = handle === 'start' ? nextValue.startSeconds : nextValue.endSeconds;
          playerHandleRef.current?.previewAt(previewSeconds);
        }
      } catch (error) {
        console.error('[TrimRangeSlider] Keyframe snap request failed:', error);
      } finally {
        if (requestId === snapRequestIdRef.current) {
          setSnappingHandle((currentHandle) => (currentHandle === handle ? null : currentHandle));
        }
      }
    },
    [youtubeVideoId]
  );

  useEffect(() => {
    return () => {
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
        clearTimeout(previewThrottleTimerRef.current);
      }

      previewThrottleTimerRef.current = setTimeout(() => {
        previewThrottleTimerRef.current = null;
        const pendingSeconds = pendingPreviewSecondsRef.current;
        pendingPreviewSecondsRef.current = null;
        if (pendingSeconds != null) {
          playerHandle.previewAt(pendingSeconds);
        }
      }, PREVIEW_SEEK_THROTTLE_MS);
    },
    [playerHandle]
  );

  const commitPreviewAt = useCallback(
    (seconds: number) => {
      if (!playerHandle) {
        return;
      }

      if (previewThrottleTimerRef.current) {
        clearTimeout(previewThrottleTimerRef.current);
        previewThrottleTimerRef.current = null;
      }
      pendingPreviewSecondsRef.current = null;
      playerHandle.previewAt(seconds);
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
    },
    [schedulePreviewAt]
  );

  const handleValueCommit = useCallback(
    ([startSeconds, endSeconds]: number[]) => {
      const previous = valueRef.current;
      const startMoved = Math.abs(startSeconds - previous.startSeconds);
      const endMoved = Math.abs(endSeconds - previous.endSeconds);
      const movedHandle: 'start' | 'end' = startMoved >= endMoved ? 'start' : 'end';
      const movedSeconds = movedHandle === 'start' ? startSeconds : endSeconds;
      commitPreviewAt(movedSeconds);
      if (!enableKeyframeSnap) {
        return;
      }
      const requestId = ++snapRequestIdRef.current;
      void runKeyframeSnap(movedHandle, movedSeconds, requestId);
    },
    [commitPreviewAt, enableKeyframeSnap, runKeyframeSnap]
  );

  const nudgeHandle = useCallback(
    (handle: 'start' | 'end', direction: -1 | 1) => {
      const nextValue = nudgeTrimHandleValue(valueRef.current, handle, direction, durationSeconds);
      if (!nextValue) {
        return;
      }

      onChangeRef.current(nextValue);
      const previewSeconds = handle === 'start' ? nextValue.startSeconds : nextValue.endSeconds;
      commitPreviewAt(previewSeconds);
      if (!enableKeyframeSnap) {
        return;
      }
      const requestId = ++snapRequestIdRef.current;
      void runKeyframeSnap(handle, previewSeconds, requestId);
    },
    [commitPreviewAt, durationSeconds, enableKeyframeSnap, runKeyframeSnap]
  );

  const disabled = durationSeconds <= 0;
  const maxSeconds = Math.max(durationSeconds, 0);
  const startCanNudgeEarlier = !disabled && value.startSeconds > 0;
  const startCanNudgeLater = !disabled && value.startSeconds < value.endSeconds;
  const endCanNudgeEarlier = !disabled && value.endSeconds > value.startSeconds;
  const endCanNudgeLater = !disabled && value.endSeconds < maxSeconds;
  const timestampWidthClass =
    durationSeconds >= 3600 ? 'w-[7ch] sm:min-w-[7ch]' : 'w-[5ch] sm:min-w-[5ch]';

  return (
    <div className="space-y-3" data-testid="trim-range-slider">
      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 min-[420px]:items-center min-[420px]:justify-between">
        <div className="flex min-w-0 items-center justify-center gap-0.5 min-[420px]:justify-start">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0 sm:h-9 sm:w-9"
            aria-label="Move trim start one frame earlier"
            data-testid="trim-start-nudge-earlier"
            disabled={!startCanNudgeEarlier || snappingHandle === 'start'}
            onClick={() => nudgeHandle('start', -1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span
            aria-live="polite"
            className={cn(
              'shrink-0 text-center text-xs tabular-nums text-muted-foreground sm:text-sm',
              timestampWidthClass
            )}
          >
            {formatTrimSeconds(value.startSeconds)}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0 sm:h-9 sm:w-9"
            aria-label="Move trim start one frame later"
            data-testid="trim-start-nudge-later"
            disabled={!startCanNudgeLater || snappingHandle === 'start'}
            onClick={() => nudgeHandle('start', 1)}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>

        <div className="flex min-w-0 items-center justify-center gap-0.5 min-[420px]:justify-end">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0 sm:h-9 sm:w-9"
            aria-label="Move trim end one frame earlier"
            data-testid="trim-end-nudge-earlier"
            disabled={!endCanNudgeEarlier || snappingHandle === 'end'}
            onClick={() => nudgeHandle('end', -1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span
            aria-live="polite"
            className={cn(
              'shrink-0 text-center text-xs tabular-nums text-muted-foreground sm:text-sm',
              timestampWidthClass
            )}
          >
            {formatTrimSeconds(value.endSeconds)}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0 sm:h-9 sm:w-9"
            aria-label="Move trim end one frame later"
            data-testid="trim-end-nudge-later"
            disabled={!endCanNudgeLater || snappingHandle === 'end'}
            onClick={() => nudgeHandle('end', 1)}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>

      <Slider
        min={0}
        max={maxSeconds}
        step={TRIM_NUDGE_STEP_SECONDS}
        value={[value.startSeconds, value.endSeconds]}
        onValueChange={handleValueChange}
        onValueCommit={handleValueCommit}
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
