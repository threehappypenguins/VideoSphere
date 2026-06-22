import type { UserClockFormat, UserPreferences } from '@/types';

/** Default schedule clock format when the user has not chosen a preference. */
export const DEFAULT_USER_CLOCK_FORMAT: UserClockFormat = '12';

/**
 * Normalizes stored user preferences for API responses.
 * @param value - Raw `preferences` document from MongoDB.
 * @returns Normalized preferences, or `undefined` when empty.
 */
export function normalizeStoredUserPreferences(value: unknown): UserPreferences | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const preferences: UserPreferences = {};

  if (record.clockFormat === '12' || record.clockFormat === '24') {
    preferences.clockFormat = record.clockFormat;
  }

  return Object.keys(preferences).length > 0 ? preferences : undefined;
}

/**
 * Resolves the effective clock format for a user profile.
 * @param preferences - Stored user preferences, if any.
 * @returns `'12'` or `'24'`.
 */
export function resolveUserClockFormat(preferences?: UserPreferences): UserClockFormat {
  return preferences?.clockFormat === '24' ? '24' : DEFAULT_USER_CLOCK_FORMAT;
}

/**
 * Whether the resolved clock format uses a 12-hour picker with AM/PM.
 * @param clockFormat - Resolved user clock format.
 * @returns True when schedule controls should use 12-hour columns.
 */
export function clockFormatUses12Hour(clockFormat: UserClockFormat): boolean {
  return clockFormat === '12';
}
