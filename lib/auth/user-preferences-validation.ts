import type { UserClockFormat, UserPreferences } from '@/types';

/**
 * Result of parsing a PATCH `preferences` payload.
 */
export type UserPreferencesParseResult =
  | { ok: true; preferences?: Partial<UserPreferences> }
  | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates optional `preferences` from a profile PATCH body.
 * @param value - Raw `preferences` value from the request JSON.
 * @returns Parsed preferences for merge, or a validation error message.
 */
export function parseUserPreferencesPatch(value: unknown): UserPreferencesParseResult {
  if (value === undefined) {
    return { ok: true };
  }

  if (!isPlainObject(value)) {
    return { ok: false, error: 'preferences must be an object.' };
  }

  const keys = Object.keys(value);
  if (keys.length === 0) {
    return { ok: true };
  }

  if (keys.some((key) => key !== 'clockFormat')) {
    return { ok: false, error: 'preferences contains unsupported keys.' };
  }

  if (value.clockFormat === undefined) {
    return { ok: true };
  }

  if (value.clockFormat !== '12' && value.clockFormat !== '24') {
    return { ok: false, error: 'preferences.clockFormat must be "12" or "24".' };
  }

  return {
    ok: true,
    preferences: { clockFormat: value.clockFormat as UserClockFormat },
  };
}
