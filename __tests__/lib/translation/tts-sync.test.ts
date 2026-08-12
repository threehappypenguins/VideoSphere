// =============================================================================
// Tests for lib/translation/tts-sync
// =============================================================================

import { describe, expect, it } from 'vitest';
import {
  playbackRateForLag,
  trimTtsQueueForLag,
  TTS_SYNC_BASELINE_LAG_MS,
  TTS_SYNC_MAX_PLAYBACK_RATE,
  TTS_SYNC_RATE_RAMP_FULL_MS,
  TTS_SYNC_RATE_RAMP_START_MS,
  TTS_SYNC_SKIP_LAG_MS,
  type TtsQueueItem,
} from '@/lib/translation/tts-sync';

function item(url: string, sourceTs: number): TtsQueueItem {
  return { url, sourceTs };
}

describe('playbackRateForLag', () => {
  it('stays at 1.0 through the pipeline floor plus a small cushion', () => {
    expect(playbackRateForLag(0)).toBe(1);
    expect(playbackRateForLag(TTS_SYNC_BASELINE_LAG_MS)).toBe(1);
    expect(playbackRateForLag(TTS_SYNC_BASELINE_LAG_MS + TTS_SYNC_RATE_RAMP_START_MS)).toBe(1);
  });

  it('ramps linearly toward the max rate as backlog grows', () => {
    const midExcess =
      TTS_SYNC_RATE_RAMP_START_MS + (TTS_SYNC_RATE_RAMP_FULL_MS - TTS_SYNC_RATE_RAMP_START_MS) / 2;
    const mid = playbackRateForLag(TTS_SYNC_BASELINE_LAG_MS + midExcess);
    expect(mid).toBeCloseTo(1 + (TTS_SYNC_MAX_PLAYBACK_RATE - 1) / 2, 5);
  });

  it('caps at the max rate for severe lag', () => {
    expect(playbackRateForLag(TTS_SYNC_BASELINE_LAG_MS + TTS_SYNC_RATE_RAMP_FULL_MS)).toBe(
      TTS_SYNC_MAX_PLAYBACK_RATE
    );
    expect(playbackRateForLag(60_000)).toBe(TTS_SYNC_MAX_PLAYBACK_RATE);
  });

  it('treats invalid lag as zero', () => {
    expect(playbackRateForLag(Number.NaN)).toBe(1);
  });
});

describe('trimTtsQueueForLag', () => {
  const now = 100_000;

  it('leaves a single clip alone even when stale', () => {
    const queue = [item('/a', now - TTS_SYNC_SKIP_LAG_MS - 1)];
    expect(trimTtsQueueForLag(queue, now)).toEqual(queue);
  });

  it('keeps clips that are still within the skip threshold', () => {
    const queue = [item('/a', now - TTS_SYNC_SKIP_LAG_MS + 1), item('/b', now - 1_000)];
    expect(trimTtsQueueForLag(queue, now)).toEqual(queue);
  });

  it('drops oldest stale clips while keeping the newest', () => {
    const queue = [
      item('/old-1', now - TTS_SYNC_SKIP_LAG_MS - 5_000),
      item('/old-2', now - TTS_SYNC_SKIP_LAG_MS - 1_000),
      item('/fresh', now - 2_000),
    ];
    expect(trimTtsQueueForLag(queue, now)).toEqual([item('/fresh', now - 2_000)]);
  });

  it('stops dropping once the head is no longer past the threshold', () => {
    const queue = [
      item('/stale', now - TTS_SYNC_SKIP_LAG_MS - 1),
      item('/ok', now - TTS_SYNC_SKIP_LAG_MS + 500),
      item('/newer', now - 1_000),
    ];
    expect(trimTtsQueueForLag(queue, now)).toEqual([
      item('/ok', now - TTS_SYNC_SKIP_LAG_MS + 500),
      item('/newer', now - 1_000),
    ]);
  });

  it('returns a shallow copy', () => {
    const queue = [item('/a', now)];
    const trimmed = trimTtsQueueForLag(queue, now);
    expect(trimmed).not.toBe(queue);
    expect(trimmed).toEqual(queue);
  });
});
