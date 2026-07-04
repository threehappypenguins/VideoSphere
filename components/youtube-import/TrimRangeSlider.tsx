'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider, SliderRange, SliderThumb, SliderTrack } from '@/components/ui/slider';
import type { YouTubePlayerHandle } from '@/components/youtube-import/YouTubePreviewPlayer';
import { formatVideoDuration } from '@/lib/format-video-duration';
import {
  formatTrimTimeInputValue,
  parseTrimTimeInput,
  TRIM_JUMP_STEP_OPTIONS,
  type TrimJumpStepSeconds,
} from '@/lib/parse-trim-time-input';
import { cn } from '@/lib/utils';

/** Debounce interval for preview seeks while dragging trim handles. */
const PREVIEW_SEEK_THROTTLE_MS = 100;

/** Ignore keyframe candidates farther than this from the released handle position. */
const MAX_KEYFRAME_SNAP_DISTANCE_SECONDS = 4;

/** Step size for frame nudge buttons (~one 30fps frame). */
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
   * Called when the user adjusts either handle.
   * @param value - Updated trim range.
   */
  onChange: (value: { startSeconds: number; endSeconds: number }) => void;
  /** Optional preview player handle to seek while trimming. */
  playerHandle?: YouTubePlayerHandle;
  /** When false, trim handles stay without keyframe probing after precise edits. */
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
 * Applies an absolute timestamp to one trim handle.
 * @param value - Current trim range in seconds.
 * @param handle - Which handle to move.
 * @param seconds - Target timestamp in seconds.
 * @param durationSeconds - Total source duration in seconds.
 * @returns Updated trim range.
 */
export function applyTrimHandleSeconds(
  value: { startSeconds: number; endSeconds: number },
  handle: 'start' | 'end',
  seconds: number,
  durationSeconds: number
): { startSeconds: number; endSeconds: number } {
  const max = Math.max(durationSeconds, 0);

  if (handle === 'start') {
    return {
      startSeconds: clampTrimSeconds(seconds, 0, value.endSeconds),
      endSeconds: value.endSeconds,
    };
  }

  return {
    startSeconds: value.startSeconds,
    endSeconds: clampTrimSeconds(seconds, value.startSeconds, max),
  };
}

/**
 * Applies one step nudge to a trim handle.
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

interface TrimTimestampFieldProps {
  /** Which trim handle this field edits. */
  handle: 'start' | 'end';
  /** Current timestamp in seconds. */
  seconds: number;
  /** Whether editing is disabled. */
  disabled: boolean;
  /** Whether a keyframe snap is in progress for this handle. */
  isSnapping: boolean;
  /** Minimum width class for the timestamp display. */
  widthClass: string;
  /**
   * Called when the user commits a parsed timestamp.
   * @param seconds - Parsed timestamp in seconds.
   */
  onCommit: (seconds: number) => void;
}

/**
 * Tap-to-edit trim timestamp control.
 * @param props - Field configuration.
 * @returns Editable timestamp UI.
 */
function TrimTimestampField({
  handle,
  seconds,
  disabled,
  isSnapping,
  widthClass,
  onCommit,
}: TrimTimestampFieldProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const skipBlurCommitRef = useRef(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftValue, setDraftValue] = useState('');
  const [hasError, setHasError] = useState(false);

  const beginEditing = () => {
    if (disabled || isSnapping) {
      return;
    }
    skipBlurCommitRef.current = false;
    setDraftValue(formatTrimTimeInputValue(seconds));
    setHasError(false);
    setIsEditing(true);
  };

  useEffect(() => {
    if (!isEditing) {
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isEditing]);

  const cancelEditing = () => {
    skipBlurCommitRef.current = true;
    setIsEditing(false);
    setHasError(false);
  };

  const commitEditing = () => {
    const parsed = parseTrimTimeInput(draftValue);
    if (parsed == null) {
      setHasError(true);
      return;
    }

    skipBlurCommitRef.current = true;
    setIsEditing(false);
    setHasError(false);
    onCommit(parsed);
  };

  const handleBlur = () => {
    if (skipBlurCommitRef.current) {
      skipBlurCommitRef.current = false;
      return;
    }

    commitEditing();
  };

  const label = handle === 'start' ? 'Trim start time' : 'Trim end time';

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        id={inputId}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label={label}
        data-testid={`trim-${handle}-time-input`}
        value={draftValue}
        disabled={disabled}
        onChange={(event) => {
          setDraftValue(event.target.value);
          if (hasError) {
            setHasError(false);
          }
        }}
        onBlur={handleBlur}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commitEditing();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            cancelEditing();
          }
        }}
        className={cn(
          'h-8 shrink-0 px-2 text-center text-xs tabular-nums sm:h-9 sm:text-sm',
          widthClass,
          hasError && 'border-destructive focus-visible:ring-destructive'
        )}
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={`${label}. Tap to edit.`}
      data-testid={`trim-${handle}-time-display`}
      disabled={disabled || isSnapping}
      onClick={beginEditing}
      className={cn(
        'h-8 shrink-0 rounded-md border border-input bg-background px-2 text-center text-xs tabular-nums text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 sm:h-9 sm:text-sm',
        widthClass
      )}
    >
      <span aria-live="polite">{formatTrimSeconds(seconds)}</span>
    </button>
  );
}

interface TrimHandleControlsProps {
  /** Which trim handle these controls adjust. */
  handle: 'start' | 'end';
  /** Current timestamp in seconds for this handle. */
  seconds: number;
  /** Whether controls are disabled. */
  disabled: boolean;
  /** Whether a keyframe snap is in progress for this handle. */
  isSnapping: boolean;
  /** Selected coarse jump distance in seconds. */
  jumpStepSeconds: TrimJumpStepSeconds;
  /** Whether the jump-earlier button is enabled. */
  canJumpEarlier: boolean;
  /** Whether the frame-earlier button is enabled. */
  canFrameEarlier: boolean;
  /** Whether the frame-later button is enabled. */
  canFrameLater: boolean;
  /** Whether the jump-later button is enabled. */
  canJumpLater: boolean;
  /** Minimum width class for the timestamp display. */
  timestampWidthClass: string;
  /**
   * Nudges the handle by the given step.
   * @param direction - `-1` for earlier, `1` for later.
   * @param stepSeconds - Distance in seconds.
   */
  onNudge: (direction: -1 | 1, stepSeconds: number) => void;
  /**
   * Sets the handle to an absolute timestamp.
   * @param seconds - Target timestamp in seconds.
   */
  onCommitSeconds: (seconds: number) => void;
}

/**
 * Per-handle trim controls: jump nudge, frame nudge, and editable timestamp.
 * @param props - Control configuration.
 * @returns Handle control row.
 */
function TrimHandleControls({
  handle,
  seconds,
  disabled,
  isSnapping,
  jumpStepSeconds,
  canJumpEarlier,
  canFrameEarlier,
  canFrameLater,
  canJumpLater,
  timestampWidthClass,
  onNudge,
  onCommitSeconds,
}: TrimHandleControlsProps) {
  const handleLabel = handle === 'start' ? 'start' : 'end';

  return (
    <div className="flex min-w-0 items-center justify-center gap-0.5 sm:gap-1">
      <Button
        type="button"
        variant="outline"
        className="h-8 shrink-0 gap-0.5 px-1.5 sm:h-9 sm:px-2"
        aria-label={`Move trim ${handleLabel} earlier by ${jumpStepSeconds} seconds`}
        data-testid={`trim-${handle}-jump-earlier`}
        disabled={!canJumpEarlier || isSnapping}
        onClick={() => onNudge(-1, jumpStepSeconds)}
      >
        <ChevronLeft aria-hidden="true" className="h-4 w-4" />
        <span className="text-xs tabular-nums">{jumpStepSeconds}s</span>
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 shrink-0 sm:h-9 sm:w-9"
        aria-label={`Move trim ${handleLabel} one frame earlier`}
        data-testid={`trim-${handle}-frame-earlier`}
        disabled={!canFrameEarlier || isSnapping}
        onClick={() => onNudge(-1, TRIM_NUDGE_STEP_SECONDS)}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      <TrimTimestampField
        handle={handle}
        seconds={seconds}
        disabled={disabled}
        isSnapping={isSnapping}
        widthClass={timestampWidthClass}
        onCommit={onCommitSeconds}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 shrink-0 sm:h-9 sm:w-9"
        aria-label={`Move trim ${handleLabel} one frame later`}
        data-testid={`trim-${handle}-frame-later`}
        disabled={!canFrameLater || isSnapping}
        onClick={() => onNudge(1, TRIM_NUDGE_STEP_SECONDS)}
      >
        <ChevronRight aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-8 shrink-0 gap-0.5 px-1.5 sm:h-9 sm:px-2"
        aria-label={`Move trim ${handleLabel} later by ${jumpStepSeconds} seconds`}
        data-testid={`trim-${handle}-jump-later`}
        disabled={!canJumpLater || isSnapping}
        onClick={() => onNudge(1, jumpStepSeconds)}
      >
        <span className="text-xs tabular-nums">{jumpStepSeconds}s</span>
        <ChevronRight aria-hidden="true" className="h-4 w-4" />
      </Button>
    </div>
  );
}

/**
 * Two-handle trim slider with editable timestamps and precise nudge controls.
 * Keyframe snap runs after typed times, nudge buttons, and slider release when
 * {@link TrimRangeSliderProps.enableKeyframeSnap} is true (stream-copy / smart cut off).
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
  const [jumpStepSeconds, setJumpStepSeconds] = useState<TrimJumpStepSeconds>(5);
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

  const commitHandleValue = useCallback(
    (handle: 'start' | 'end', nextValue: { startSeconds: number; endSeconds: number }) => {
      const previewSeconds = handle === 'start' ? nextValue.startSeconds : nextValue.endSeconds;
      const current = valueRef.current;

      if (
        nextValue.startSeconds === current.startSeconds &&
        nextValue.endSeconds === current.endSeconds
      ) {
        return;
      }

      onChangeRef.current(nextValue);
      commitPreviewAt(previewSeconds);

      if (!enableKeyframeSnap) {
        return;
      }

      const requestId = ++snapRequestIdRef.current;
      void runKeyframeSnap(handle, previewSeconds, requestId);
    },
    [commitPreviewAt, enableKeyframeSnap, runKeyframeSnap]
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
    (handle: 'start' | 'end', direction: -1 | 1, stepSeconds: number) => {
      const nextValue = nudgeTrimHandleValue(
        valueRef.current,
        handle,
        direction,
        durationSeconds,
        stepSeconds
      );
      if (!nextValue) {
        return;
      }

      commitHandleValue(handle, nextValue);
    },
    [commitHandleValue, durationSeconds]
  );

  const setHandleSeconds = useCallback(
    (handle: 'start' | 'end', seconds: number) => {
      const nextValue = applyTrimHandleSeconds(valueRef.current, handle, seconds, durationSeconds);
      commitHandleValue(handle, nextValue);
    },
    [commitHandleValue, durationSeconds]
  );

  const disabled = durationSeconds <= 0;
  const maxSeconds = Math.max(durationSeconds, 0);
  const startCanJumpEarlier = !disabled && value.startSeconds > 0;
  const startCanFrameEarlier = startCanJumpEarlier;
  const startCanFrameLater = !disabled && value.startSeconds < value.endSeconds;
  const startCanJumpLater = startCanFrameLater;
  const endCanJumpEarlier = !disabled && value.endSeconds > value.startSeconds;
  const endCanFrameEarlier = endCanJumpEarlier;
  const endCanFrameLater = !disabled && value.endSeconds < maxSeconds;
  const endCanJumpLater = endCanFrameLater;
  const timestampWidthClass =
    durationSeconds >= 3600 ? 'w-[7ch] sm:min-w-[7ch]' : 'w-[5ch] sm:min-w-[5ch]';

  return (
    <div className="space-y-4" data-testid="trim-range-slider">
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground sm:text-sm">Start</Label>
        <TrimHandleControls
          handle="start"
          seconds={value.startSeconds}
          disabled={disabled}
          isSnapping={snappingHandle === 'start'}
          jumpStepSeconds={jumpStepSeconds}
          canJumpEarlier={startCanJumpEarlier}
          canFrameEarlier={startCanFrameEarlier}
          canFrameLater={startCanFrameLater}
          canJumpLater={startCanJumpLater}
          timestampWidthClass={timestampWidthClass}
          onNudge={(direction, stepSeconds) => nudgeHandle('start', direction, stepSeconds)}
          onCommitSeconds={(seconds) => setHandleSeconds('start', seconds)}
        />
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
          className={cn('h-7 w-7 sm:h-5 sm:w-5', snappingHandle === 'start' && 'relative')}
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
          className={cn('h-7 w-7 sm:h-5 sm:w-5', snappingHandle === 'end' && 'relative')}
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

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground sm:text-sm">End</Label>
        <TrimHandleControls
          handle="end"
          seconds={value.endSeconds}
          disabled={disabled}
          isSnapping={snappingHandle === 'end'}
          jumpStepSeconds={jumpStepSeconds}
          canJumpEarlier={endCanJumpEarlier}
          canFrameEarlier={endCanFrameEarlier}
          canFrameLater={endCanFrameLater}
          canJumpLater={endCanJumpLater}
          timestampWidthClass={timestampWidthClass}
          onNudge={(direction, stepSeconds) => nudgeHandle('end', direction, stepSeconds)}
          onCommitSeconds={(seconds) => setHandleSeconds('end', seconds)}
        />
      </div>

      <div
        className="flex flex-wrap items-center justify-center gap-2"
        role="group"
        aria-label="Jump amount"
      >
        <span className="text-xs text-muted-foreground">Jump</span>
        {TRIM_JUMP_STEP_OPTIONS.map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={jumpStepSeconds === option ? 'default' : 'outline'}
            className="h-8 px-3 text-xs tabular-nums"
            data-testid={`trim-jump-step-${option}`}
            aria-pressed={jumpStepSeconds === option}
            onClick={() => setJumpStepSeconds(option)}
          >
            {option}s
          </Button>
        ))}
      </div>
    </div>
  );
}
