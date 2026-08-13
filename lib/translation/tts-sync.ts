// =============================================================================
// Live TTS lag recovery (client playback)
// =============================================================================
// Timing logs showed a ~6–8 s fixed pipeline floor that speaking faster cannot erase,
// plus a backlog that grows when expansion > 1 or when slow clips arrive in bursts.
//
// Prefer dropping stale queued clips over racing through them. Client playbackRate is a
// gentle nudge only: French (and similar) may already be synthesized above 1.0× via GCP
// speakingRate, and stacking a large HTML rate on top sounds unnaturally fast. Caption
// text is never dropped.
// =============================================================================

/**
 * Expected fixed pipeline lag (STT → MT → TTS). Excess above this is backlog to recover.
 * Calibrated from live Mandarin/French timing summaries (pipeline p50 ≈ 7–8 s).
 */
export const TTS_SYNC_BASELINE_LAG_MS = 8_000;

/**
 * Start raising playbackRate once backlog excess exceeds this.
 * Kept high so ordinary ~10 s lag (mostly pipeline) does not sound hurried.
 */
export const TTS_SYNC_RATE_RAMP_START_MS = 6_000;

/** Reach {@link TTS_SYNC_MAX_PLAYBACK_RATE} at this excess over the baseline. */
export const TTS_SYNC_RATE_RAMP_FULL_MS = 16_000;

/**
 * Maximum HTMLAudioElement playbackRate.
 *
 * Kept modest because it stacks with GCP `speakingRate` (e.g. French 1.12×). A 1.25
 * client rate on top of that is ~1.4× overall and reads as unnatural to listeners.
 */
export const TTS_SYNC_MAX_PLAYBACK_RATE = 1.1;

/**
 * Drop older queued clips when the next clip's lag exceeds this.
 * Prefer skip over speed when far behind — captions stay; spoken audio jumps forward.
 */
export const TTS_SYNC_SKIP_LAG_MS = 15_000;

/** Queued TTS clip awaiting playback. */
export interface TtsQueueItem {
  /** Public `/api/translation/public/audio/...` URL. */
  url: string;
  /** Source segment finalisation time (`caption.ts` from the hub). */
  sourceTs: number;
}

/**
 * Chooses a playback rate from how far behind the source the next clip is.
 * @param lagMs - `now - sourceTs` for the clip about to play.
 * @returns Rate in `[1, TTS_SYNC_MAX_PLAYBACK_RATE]`.
 */
export function playbackRateForLag(lagMs: number): number {
  const lag = Number.isFinite(lagMs) ? Math.max(0, lagMs) : 0;
  const excess = Math.max(0, lag - TTS_SYNC_BASELINE_LAG_MS);
  if (excess <= TTS_SYNC_RATE_RAMP_START_MS) return 1;
  if (excess >= TTS_SYNC_RATE_RAMP_FULL_MS) return TTS_SYNC_MAX_PLAYBACK_RATE;
  const t =
    (excess - TTS_SYNC_RATE_RAMP_START_MS) /
    (TTS_SYNC_RATE_RAMP_FULL_MS - TTS_SYNC_RATE_RAMP_START_MS);
  return 1 + t * (TTS_SYNC_MAX_PLAYBACK_RATE - 1);
}

/**
 * Drops oldest queued clips that are hopelessly behind while newer audio exists.
 *
 * Never empties the queue: at least the newest clip is kept so the listener still
 * hears something current rather than silence.
 * @param queue - Ordered clips (oldest first).
 * @param nowMs - Current wall-clock time.
 * @returns Trimmed queue (may be the same array contents when nothing is dropped).
 */
export function trimTtsQueueForLag(queue: readonly TtsQueueItem[], nowMs: number): TtsQueueItem[] {
  if (queue.length <= 1) return [...queue];
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const out = [...queue];
  while (out.length > 1) {
    const head = out[0]!;
    if (now - head.sourceTs < TTS_SYNC_SKIP_LAG_MS) break;
    out.shift();
  }
  return out;
}
