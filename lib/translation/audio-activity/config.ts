// =============================================================================
// Audio activity detection — environment configuration
// =============================================================================
// Thresholds live in the environment rather than the channel document because they
// are calibration knobs for a room and a mixer, not a per-listener preference. Tune
// them once against a recording of a real service, then leave them alone.
// =============================================================================

import type { AudioActivityDetectorOptions } from '@/lib/translation/audio-activity/detector';

/**
 * Reads a positive number from the environment.
 * @param name - Environment variable name.
 * @returns Parsed value, or undefined when unset or invalid.
 */
function envNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return undefined;
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

/**
 * Whether captions should be suppressed automatically during singing/music.
 *
 * Enabled by default; set `TRANSLATION_MUSIC_DETECTION=off` (or `false`/`0`) to
 * caption everything, including worship music.
 * @returns True when automatic music detection is active.
 */
export function isMusicDetectionEnabled(): boolean {
  const raw = (process.env.TRANSLATION_MUSIC_DETECTION ?? '').trim().toLowerCase();
  return raw !== 'off' && raw !== 'false' && raw !== '0' && raw !== 'no';
}

/**
 * Builds detector options from environment overrides, falling back to defaults.
 * @returns Options suitable for `createAudioActivityDetector`.
 */
export function audioActivityDetectorOptionsFromEnv(): AudioActivityDetectorOptions {
  const options: AudioActivityDetectorOptions = {};

  const windowMs = envNumber('TRANSLATION_MUSIC_WINDOW_MS');
  if (windowMs !== undefined) options.windowMs = windowMs;

  const hopMs = envNumber('TRANSLATION_MUSIC_HOP_MS');
  if (hopMs !== undefined) options.hopMs = hopMs;

  const enterMusicMs = envNumber('TRANSLATION_MUSIC_ENTER_MS');
  if (enterMusicMs !== undefined) options.enterMusicMs = enterMusicMs;

  const exitMusicMs = envNumber('TRANSLATION_MUSIC_EXIT_MS');
  if (exitMusicMs !== undefined) options.exitMusicMs = exitMusicMs;

  const minMusicDwellMs = envNumber('TRANSLATION_MUSIC_MIN_DWELL_MS');
  if (minMusicDwellMs !== undefined) options.minMusicDwellMs = minMusicDwellMs;

  const musicThreshold = envNumber('TRANSLATION_MUSIC_THRESHOLD');
  if (musicThreshold !== undefined && musicThreshold <= 1) {
    options.musicThreshold = musicThreshold;
  }

  const speechThreshold = envNumber('TRANSLATION_MUSIC_SPEECH_THRESHOLD');
  if (speechThreshold !== undefined && speechThreshold <= 1) {
    options.speechThreshold = speechThreshold;
  }

  return options;
}
