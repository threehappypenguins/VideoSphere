import type { Livestream } from '@/types';

/** Default minutes before start when a temp-slot livestream auto-promotes to main. */
export const DEFAULT_AUTO_PROMOTE_TO_MAIN_KEY_MINUTES = 30;

/** Minimum selectable auto-promote lead time in minutes. */
export const MIN_AUTO_PROMOTE_TO_MAIN_KEY_MINUTES = 5;

/** Maximum selectable auto-promote lead time in minutes. */
export const MAX_AUTO_PROMOTE_TO_MAIN_KEY_MINUTES = 60;

/** Step size for auto-promote lead time options in the UI. */
export const AUTO_PROMOTE_TO_MAIN_KEY_MINUTES_STEP = 5;

/** Selectable auto-promote lead times from 5 through 60 minutes in 5-minute steps. */
export const AUTO_PROMOTE_TO_MAIN_KEY_MINUTE_OPTIONS = Array.from(
  {
    length:
      (MAX_AUTO_PROMOTE_TO_MAIN_KEY_MINUTES - MIN_AUTO_PROMOTE_TO_MAIN_KEY_MINUTES) /
        AUTO_PROMOTE_TO_MAIN_KEY_MINUTES_STEP +
      1,
  },
  (_, index) => MIN_AUTO_PROMOTE_TO_MAIN_KEY_MINUTES + index * AUTO_PROMOTE_TO_MAIN_KEY_MINUTES_STEP
);

/**
 * Returns whether a temp-slot livestream should auto-promote to the main key.
 * Defaults to enabled when unset on temp-slot rows.
 * @param livestream - Livestream row or editor snapshot.
 * @returns True when automatic promotion is enabled.
 */
export function resolveAutoPromoteToMainKeyEnabled(
  livestream: Pick<Livestream, 'autoPromoteToMainKey' | 'keySlot'>
): boolean {
  if (livestream.autoPromoteToMainKey === false) {
    return false;
  }
  return livestream.keySlot === 'temp';
}

/**
 * Resolves the configured auto-promote lead time in minutes for a temp-slot livestream.
 * @param livestream - Livestream row or editor snapshot.
 * @returns Lead time in minutes, defaulting to 30 when unset or invalid.
 */
export function resolveAutoPromoteToMainKeyMinutes(
  livestream: Pick<Livestream, 'autoPromoteToMainKeyMinutes'>
): number {
  return normalizeAutoPromoteToMainKeyMinutes(livestream.autoPromoteToMainKeyMinutes);
}

/**
 * Normalizes a stored or requested auto-promote lead time to a supported value.
 * @param value - Raw minutes value.
 * @returns Supported minutes between 5 and 60, or the default when invalid.
 */
export function normalizeAutoPromoteToMainKeyMinutes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return DEFAULT_AUTO_PROMOTE_TO_MAIN_KEY_MINUTES;
  }
  if (
    value < MIN_AUTO_PROMOTE_TO_MAIN_KEY_MINUTES ||
    value > MAX_AUTO_PROMOTE_TO_MAIN_KEY_MINUTES ||
    value % AUTO_PROMOTE_TO_MAIN_KEY_MINUTES_STEP !== 0
  ) {
    return DEFAULT_AUTO_PROMOTE_TO_MAIN_KEY_MINUTES;
  }
  return value;
}

/**
 * Parses an auto-promote lead time from a PATCH/POST request body field.
 * @param value - Raw request value.
 * @returns Parsed minutes or an error message.
 */
export function parseAutoPromoteToMainKeyMinutesFromRequestBody(
  value: unknown
): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return { ok: false, error: 'autoPromoteToMainKeyMinutes must be an integer' };
  }
  if (
    value < MIN_AUTO_PROMOTE_TO_MAIN_KEY_MINUTES ||
    value > MAX_AUTO_PROMOTE_TO_MAIN_KEY_MINUTES ||
    value % AUTO_PROMOTE_TO_MAIN_KEY_MINUTES_STEP !== 0
  ) {
    return {
      ok: false,
      error: `autoPromoteToMainKeyMinutes must be between ${MIN_AUTO_PROMOTE_TO_MAIN_KEY_MINUTES} and ${MAX_AUTO_PROMOTE_TO_MAIN_KEY_MINUTES} in steps of ${AUTO_PROMOTE_TO_MAIN_KEY_MINUTES_STEP}`,
    };
  }
  return { ok: true, value };
}

/**
 * Parses the auto-promote enabled flag from a PATCH/POST request body field.
 * @param value - Raw request value.
 * @returns Parsed boolean or an error message.
 */
export function parseAutoPromoteToMainKeyFromRequestBody(
  value: unknown
): { ok: true; value: boolean } | { ok: false; error: string } {
  if (typeof value !== 'boolean') {
    return { ok: false, error: 'autoPromoteToMainKey must be a boolean' };
  }
  return { ok: true, value };
}

/**
 * Formats an auto-promote lead time for UI labels.
 * @param minutes - Lead time in minutes.
 * @returns Human-readable label such as "30 minutes before start".
 */
export function formatAutoPromoteToMainKeyMinutesLabel(minutes: number): string {
  return `${minutes} minute${minutes === 1 ? '' : 's'} before start`;
}
